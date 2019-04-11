/*
	Copyright (C) 2017 Balena Ltd.

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import * as Promise from 'bluebird';
import * as dns from 'dns';
import * as _ from 'lodash';
import * as net from 'net';
import * as nodeTunnel from 'node-tunnel';

import { captureException, getLogger } from '../utils';
import * as errors from '../utils/errors';

import * as device from './device';

const logger = getLogger('proxy', process.env.WORKER_ID!);

const VPN_SERVICE_API_KEY = Buffer.from(process.env.VPN_SERVICE_API_KEY!);

const lookupAsync = Promise.promisify(dns.lookup);

const parseRequest = (req: nodeTunnel.Request) => {
	if (req.url == null) {
		throw new errors.BadRequestError();
	}

	const match = req.url.match(
		/^([a-fA-F0-9]+)\.(balena|resin|vpn)(?::([0-9]+))?$/,
	);
	if (match == null) {
		throw new errors.InvalidHostnameError(`invalid hostname: ${req.url}`);
	}
	const [, uuid, tld, port = '80'] = match;
	if (tld === 'resin') {
		logger.warning(`'.resin' tld is deprecated, use '.balena'`);
	}

	let auth;
	if (req.auth != null && req.auth.password != null) {
		auth = Buffer.from(req.auth.password);
	}

	return { uuid, port: parseInt(port, 10), auth };
};

const tunnelToDevice: nodeTunnel.Middleware = (req, cltSocket, _head, next) =>
	Promise.try(() => {
		const { uuid, port, auth } = parseRequest(req);
		logger.info(`tunnel requested to device ${uuid} on port ${port}`);

		// we need to use VPN_SERVICE_API_KEY here as this could be an unauthenticated request
		return device
			.getDeviceByUUID(uuid, VPN_SERVICE_API_KEY)
			.tap(data => {
				if (data == null) {
					cltSocket.end('HTTP/1.0 404 Not Found\r\n\r\n');
					throw new errors.HandledTunnelingError(`device not found: ${uuid}`);
				}
			})
			.tap(data =>
				device
					.canAccessDevice(data, port, auth)
					.tap(isAllowed => {
						if (!isAllowed) {
							cltSocket.end(
								'HTTP/1.0 407 Proxy Authorization Required\r\n\r\n',
							);
							throw new errors.HandledTunnelingError(
								`device not accessible: ${uuid}`,
							);
						}
					})
					.tap(() => {
						if (!data.is_connected_to_vpn) {
							cltSocket.end('HTTP/1.0 503 Service Unavailable\r\n\r\n');
							throw new errors.HandledTunnelingError(
								`device not available: ${uuid}`,
							);
						}
					}),
			)
			.tap(() => (req.url = `${uuid}.vpn:${port}`));
	})
		.then(() => next())
		.catch(errors.APIError, err => {
			logger.alert(`Invalid Response from API (${err.message})`);
			cltSocket.end('HTTP/1.0 500 Internal Server Error\r\n\r\n');
		})
		.catch(errors.BadRequestError, () =>
			cltSocket.end('HTTP/1.0 400 Bad Request\r\n\r\n'),
		)
		.catch(errors.HandledTunnelingError, err =>
			logger.crit(`Tunneling Error (${err.message})`),
		)
		.catch(errors.InvalidHostnameError, () =>
			cltSocket.end('HTTP/1.0 403 Forbidden\r\n\r\n'),
		)
		.catch((err: Error) => {
			captureException(
				err,
				`unexpected error establishing tunnel to ${req.url} (${err.message})`,
				{
					req,
				},
			);
			cltSocket.end('HTTP/1.0 500 Internal Server Error\r\n\r\n');
		});

class Tunnel extends nodeTunnel.Tunnel {
	public connect(
		port: number,
		host: string,
		client: net.Socket,
		req: nodeTunnel.Request,
	) {
		return Promise.try(() => parseRequest(req)).then(({ uuid, auth }) =>
			lookupAsync(`${uuid}.vpn`)
				.then(() => {
					logger.info(`connecting to ${host}:${port}`);
					return super.connect(port, host, client, req);
				})
				.catch(() => {
					return device
						.getDeviceVpnHost(uuid, auth)
						.catch(errors.APIError, err => {
							logger.crit(
								`error connecting to device ${uuid} on port ${port} (${
									err.message
								})`,
							);
							throw new errors.HandledTunnelingError(err.message);
						})
						.then(vpnHost => {
							logger.info(
								`forwarding tunnel request for ${uuid}:${port} via ${vpnHost}`,
							);
							return forwardRequest(vpnHost, uuid, port, auth).catch(
								errors.RemoteTunnellingError,
								err => {
									logger.crit(
										`error forwarding request for ${uuid}:${port} (${
											err.message
										})`,
									);
									throw new errors.HandledTunnelingError(err.message);
								},
							);
						});
				}),
		);
	}
}

const forwardRequest = (
	vpnHost: string,
	uuid: string,
	port: number,
	proxyAuth?: Buffer,
): Promise<net.Socket> =>
	new Promise((resolve, reject) => {
		let tunnelProxyResponse = '';
		const socket: net.Socket = net.connect(3128, vpnHost, () => {
			socket.write(`CONNECT ${uuid}.balena:${port} HTTP/1.0\r\n`);
			if (proxyAuth != null) {
				socket.write(
					`Proxy-Authorization: Basic ${proxyAuth.toString('base64')}\r\n`,
				);
			}
			socket.write('\r\n\r\n');
		});

		const earlyEnd = () => {
			reject(
				new errors.RemoteTunnellingError(
					`could not connect to device ${uuid} on port ${port}: tunneling socket closed prematurely.`,
				),
			);
		};
		const earlyError = (err: Error) => {
			let errMsg = 'could not connect to vpn tunnel';
			if (err != null && err.message) {
				errMsg += `: ${err.message}`;
			}
			captureException(err, errMsg);
			reject(new errors.RemoteTunnellingError(errMsg));
		};
		const proxyData = (chunk: Buffer) => {
			if (chunk != null) {
				tunnelProxyResponse += chunk.toString();
			}

			// read 'data' chunks until full HTTP status line has been read
			if (!_.includes(tunnelProxyResponse, '\r\n\r\n')) {
				return;
			}
			socket.removeListener('data', proxyData);
			socket.removeListener('end', earlyEnd);
			socket.removeListener('error', earlyError);

			// RFC2616: Status-Line = HTTP-Version SP Status-Code SP Reason-Phrase CRLF
			const httpStatusLine = tunnelProxyResponse.split('\r\n')[0];
			const httpStatusCode = parseInt(httpStatusLine.split(' ')[1], 10);

			if (httpStatusCode !== 200) {
				return reject(
					new errors.RemoteTunnellingError(
						`could not connect to ${uuid}:${port}: ${httpStatusLine}`,
					),
				);
			}
			resolve(socket);
		};

		socket
			.on('end', earlyEnd)
			.on('error', earlyError)
			.on('data', proxyData);
	});

const worker = (port: string) => {
	logger.info(`process started with pid=${process.pid}`);
	const tunnel = new Tunnel();
	tunnel.use(tunnelToDevice);
	tunnel.listen(port, () => logger.info(`tunnel listening on port ${port}`));
	tunnel.on('error', err => {
		// errors thrown in `Tunnel.connect` will appear here
		if (!(err instanceof errors.HandledTunnelingError)) {
			logger.crit(
				`failed to connect to device (${err.message || err})\n${err.stack}`,
			);
			captureException(err);
		}
	});
	return tunnel;
};
export default worker;
