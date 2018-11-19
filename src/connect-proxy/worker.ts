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

import * as dns from 'dns';
import * as Promise from 'bluebird';
import * as _ from 'lodash';
import * as net from 'net';
import * as nodeTunnel from 'node-tunnel';

import { captureException, HandledTunnelingError } from '../errors';
import { logger } from '../utils';

import * as device from './device';

['VPN_SERVICE_API_KEY']
	.filter(key => process.env[key] == null)
	.forEach((key, idx, keys) => {
		logger.error(`${key} env variable is not set.`);
		if (idx === keys.length - 1) {
			process.exit(1);
		}
	});

const VPN_SERVICE_API_KEY = Buffer.from(process.env.VPN_SERVICE_API_KEY!);

const lookupAsync = Promise.promisify(dns.lookup);

const parseRequest = (req: nodeTunnel.Request) => {
	if (req.url == null) {
		throw new Error('Bad Request');
	}

	const match = req.url.match(
		/^([a-fA-F0-9]+)\.(balena|resin|vpn)(?::([0-9]+))?$/,
	);
	if (match == null) {
		throw new Error(`Invalid hostname: ${req.url}`);
	}
	const [, uuid, tld, port = '80'] = match;
	if (tld === 'resin') {
		logger.warn(`'.resin' tld is deprecated, use '.balena'`);
	}

	let auth = undefined;
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
					throw new HandledTunnelingError(`Device not found: ${uuid}`);
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
							throw new HandledTunnelingError(`Device not accessible: ${uuid}`);
						}
					})
					.tap(() => {
						if (!data.is_connected_to_vpn) {
							cltSocket.end('HTTP/1.0 503 Service Unavailable\r\n\r\n');
							throw new HandledTunnelingError(`Device not available: ${uuid}`);
						}
					}),
			)
			.tap(() => (req.url = `${uuid}.vpn:${port}`));
	})
		.then(() => next())
		.catch(HandledTunnelingError, (err: HandledTunnelingError) => {
			logger.error(`Tunneling Error - ${err.message}`);
		})
		.catch((err: Error) => {
			captureException(err, `error establishing tunnel to ${req.url}`, { req });
			cltSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
		});

class Tunnel extends nodeTunnel.Tunnel {
	connect(
		port: number,
		host: string,
		client: net.Socket,
		req: nodeTunnel.Request,
	) {
		return Promise.try(() => parseRequest(req))
			.tapCatch(err => client.end(err.message))
			.then(({ uuid, auth }) =>
				lookupAsync(`${uuid}.vpn`)
					.then(() => {
						logger.info(`connecting to ${host}:${port}`);
						return super
							.connect(
								port,
								host,
								client,
								req,
							)
							.tap(socket => {
								socket.on('close', () =>
									logger.info(
										`connection to device ${uuid} on port ${port} closed`,
									),
								);
								logger.info(`tunnel opened to device ${uuid} on port ${port}`);
							});
					})
					.catch(() => {
						return device
							.getDeviceVpnHost(uuid, auth)
							.then(vpnHost => {
								logger.info(
									`forwarding tunnel request for ${uuid}:${port} via ${vpnHost}`,
								);
								return forwardRequest(vpnHost, uuid, port, auth);
							})
							.tapCatch(err => client.end(err.message));
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
		const socket: net.Socket = net.connect(
			3128,
			vpnHost,
			() => {
				socket.write(`CONNECT ${uuid}.balena:${port} HTTP/1.0\r\n`);
				if (proxyAuth != null) {
					socket.write(
						`Proxy-Authorization: Basic ${proxyAuth.toString('base64')}\r\n`,
					);
				}
				socket.write('\r\n\r\n');
			},
		);

		const earlyEnd = () => {
			logger.error(
				`Could not connect to device ${uuid} on port ${port}: tunneling socket closed prematurely.`,
			);
			reject(
				new Error(
					`Could not connect to device ${uuid} on port ${port}: tunneling socket closed prematurely.`,
				),
			);
		};
		const earlyError = (err: Error) => {
			let errMsg = 'Could not connect to VPN tunnel';
			if (err != null && err.message) {
				errMsg += `: ${err.message}`;
			}
			captureException(err, errMsg);
			reject(new Error(errMsg));
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
			let httpStatusLine = tunnelProxyResponse.split('\r\n')[0];
			const httpStatusCode = parseInt(httpStatusLine.split(' ')[1], 10);

			if (httpStatusCode !== 200) {
				logger.error(
					`Could not connect to ${uuid}:${port} - ${httpStatusLine}`,
				);
				return reject(
					new Error(`Could not connect to ${uuid}:${port} - ${httpStatusLine}`),
				);
			}

			// one proxied socket, ready to go!
			logger.info(
				`tunnel opened to device ${uuid} on port ${port} via ${vpnHost}`,
			);
			socket.on('close', () =>
				logger.info(
					`connection to device ${uuid} on port ${port} via ${vpnHost} closed`,
				),
			);
			resolve(socket);
		};

		socket
			.on('end', earlyEnd)
			.on('error', earlyError)
			.on('data', proxyData);
	});

const worker = (port: string) => {
	logger.info(`connect-proxy worker process started with pid ${process.pid}`);
	const tunnel = new Tunnel();
	tunnel.use(tunnelToDevice);
	tunnel.listen(port, () => logger.info(`tunnel listening on port ${port}`));
	tunnel.on('error', err =>
		logger.error(
			`failed to connect to device ${err.message || err} ${err.stack}`,
		),
	);
	return tunnel;
};
export default worker;
