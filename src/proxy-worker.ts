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

import { metrics } from '@balena/node-metrics-gatherer';
import { promises as dns } from 'dns';
import net from 'net';
import * as nodeTunnel from 'node-tunnel';
import type winston from 'winston';

import { captureException, device, errors, getLogger, Metrics } from './utils';
import {
	VPN_CONNECT_PROXY_PORT,
	VPN_FORWARD_PROXY_PORT,
	VPN_SERVICE_API_KEY,
} from './utils/config';

const HTTP_500 = 'HTTP/1.0 500 Internal Server Error\r\n\r\n';

class Tunnel extends nodeTunnel.Tunnel {
	private readonly logger: winston.Logger;

	constructor(
		private readonly instanceId: number,
		private readonly serviceId: number,
	) {
		super();
		this.logger = getLogger('proxy', this.serviceId, this.instanceId);

		this.on('error', (err) => {
			// errors thrown in `this.connect` will appear here
			if (!(err instanceof errors.HandledTunnelingError)) {
				this.logger.crit(
					`failed to connect to device (${err.message || err})\n${err.stack}`,
				);
				captureException(err, 'proxy-connect-error');
			}
		});

		this.use(this.tunnelToDevice);
	}

	public connect = async (
		port: number,
		host: string,
		client: net.Socket,
		req: nodeTunnel.Request,
	) => {
		const { uuid, auth } = this.parseRequest(req);

		const deviceIsLocal = async () => {
			try {
				await dns.lookup(`${uuid}.vpn`);
				return true;
			} catch {
				return false;
			}
		};

		try {
			if (await deviceIsLocal()) {
				this.logger.info(`connecting to ${host}:${port}`);
				const socket = await super.connect(port, host, client, req);
				metrics.inc(Metrics.ActiveTunnels);
				metrics.inc(Metrics.TotalTunnels);
				socket.on('close', (hadError) => {
					metrics.dec(Metrics.ActiveTunnels);
					if (hadError) {
						metrics.inc(Metrics.TunnelErrors);
					}
				});
				return socket;
			} else {
				const vpnHost = await device.getDeviceVpnHost(uuid, auth);
				if (vpnHost == null) {
					client.end(HTTP_500);
					throw new errors.HandledTunnelingError(
						'service instance not found for device',
					);
				}
				if (vpnHost.id === this.serviceId) {
					client.end(HTTP_500);
					throw new errors.HandledTunnelingError(
						'device is not available on registered service instance',
					);
				}
				const forwardSignature = `By=open-balena-vpn(${this.serviceId})`;
				if (req.headers.forwarded != null) {
					if (req.headers.forwarded.includes(forwardSignature)) {
						client.end(HTTP_500);
						throw new errors.HandledTunnelingError(
							'loop detected forwarding tunnel request',
						);
					}
					req.headers.forwarded = `${req.headers.forwarded},${forwardSignature}`;
				} else {
					req.headers.forwarded = forwardSignature;
				}
				this.logger.info(
					`forwarding tunnel request for ${uuid}:${port} via ${vpnHost.id}@${vpnHost.ip_address}`,
				);
				return await this.forwardRequest(vpnHost.ip_address, uuid, port, auth);
			}
		} catch (err) {
			if (err instanceof errors.RemoteTunnellingError) {
				client.end(HTTP_500);
				this.logger.crit(
					`error forwarding request for ${uuid}:${port} (${err.message})`,
				);
				throw new errors.HandledTunnelingError(err.message);
			} else {
				this.logger.crit(
					`error connecting to ${uuid}:${port} (${err.message})`,
				);
				if (!(err instanceof errors.HandledTunnelingError)) {
					client.end(HTTP_500);
					throw new errors.HandledTunnelingError(err.message);
				}
			}
			throw err;
		}
	};

	public start = (port: number) => {
		this.listen(port, () => {
			this.logger.notice(`tunnel listening on port ${port}`);
		});
	};

	private parseRequest = (req: nodeTunnel.Request) => {
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
			this.logger.warning(`'.resin' tld is deprecated, use '.balena'`);
		}

		let auth;
		if (req.auth?.password != null) {
			auth = Buffer.from(req.auth.password);
		}

		return { uuid, port: parseInt(port, 10), auth };
	};

	private tunnelToDevice: nodeTunnel.Middleware = async (
		req,
		cltSocket,
		_head,
		next,
	) => {
		try {
			const { uuid, port, auth } = this.parseRequest(req);
			this.logger.info(`tunnel requested to ${uuid}:${port}`);

			// we need to use VPN_SERVICE_API_KEY here as this could be an unauthenticated request
			const data = await device.getDeviceByUUID(uuid, VPN_SERVICE_API_KEY);
			if (data == null) {
				cltSocket.end('HTTP/1.0 404 Not Found\r\n\r\n');
				throw new errors.HandledTunnelingError(`device not found: ${uuid}`);
			}
			const isAllowed = await device.canAccessDevice(data, port, auth);
			if (!isAllowed) {
				cltSocket.end('HTTP/1.0 407 Proxy Authorization Required\r\n\r\n');
				throw new errors.HandledTunnelingError(
					`device not accessible: ${uuid}`,
				);
			}
			if (!data.is_connected_to_vpn) {
				cltSocket.end('HTTP/1.0 503 Service Unavailable\r\n\r\n');
				throw new errors.HandledTunnelingError(`device not available: ${uuid}`);
			}
			req.url = `${uuid}.vpn:${port}`;
			next();
		} catch (err) {
			if (err instanceof errors.APIError) {
				this.logger.alert(`Invalid Response from API (${err.message})`);
				cltSocket.end(HTTP_500);
			} else if (err instanceof errors.BadRequestError) {
				cltSocket.end('HTTP/1.0 400 Bad Request\r\n\r\n');
			} else if (err instanceof errors.HandledTunnelingError) {
				this.logger.crit(`Tunneling Error (${err.message})`);
			} else if (err instanceof errors.InvalidHostnameError) {
				cltSocket.end('HTTP/1.0 403 Forbidden\r\n\r\n');
			} else {
				captureException(err, 'proxy-tunnel-error', { req });
				cltSocket.end(HTTP_500);
			}
		}
	};

	private forwardRequest = (
		vpnHost: string,
		uuid: string,
		port: number,
		proxyAuth?: Buffer,
	): Promise<net.Socket> =>
		new Promise((resolve, reject) => {
			let tunnelProxyResponse = '';
			const socket: net.Socket = net.connect(
				VPN_FORWARD_PROXY_PORT,
				vpnHost,
				() => {
					socket.write(`CONNECT ${uuid}.balena:${port} HTTP/1.0\r\n`);
					if (proxyAuth != null) {
						socket.write(
							`Proxy-Authorization: Basic ${proxyAuth.toString('base64')}\r\n`,
						);
					}
					socket.write('\r\n');
				},
			);

			const earlyEnd = () => {
				reject(
					new errors.RemoteTunnellingError(
						`could not connect to ${uuid}:${port}: tunneling socket closed prematurely`,
					),
				);
			};
			const earlyError = (err: Error) => {
				let errMsg = 'could not connect to vpn tunnel';
				if (err?.message) {
					errMsg += `: ${err.message}`;
				}
				this.logger.warning(errMsg);
				captureException(err, 'proxy-forward-error');
				reject(new errors.RemoteTunnellingError(errMsg));
			};
			const proxyData = (chunk: Buffer) => {
				// read 'data' chunks until full HTTP status line has been read
				tunnelProxyResponse += chunk.toString();
				if (!tunnelProxyResponse.includes('\r\n\r\n')) {
					return;
				}
				socket.removeListener('data', proxyData);
				socket.removeListener('end', earlyEnd);
				socket.removeListener('error', earlyError);

				// RFC2616: Status-Line = HTTP-Version SP Status-Code SP Reason-Phrase CRLF
				const httpStatusLine = tunnelProxyResponse.split('\r\n')[0];
				const httpStatusCode = parseInt(httpStatusLine.split(' ')[1], 10);

				if (httpStatusCode !== 200) {
					reject(
						new errors.RemoteTunnellingError(
							`could not connect to ${uuid}:${port}: ${httpStatusLine}`,
						),
					);
					return;
				}
				resolve(socket);
			};

			socket.on('end', earlyEnd).on('error', earlyError).on('data', proxyData);
		});
}

const worker = (instanceId: number, serviceId: number) => {
	getLogger('proxy', serviceId, instanceId).info(
		`process started with pid=${process.pid}`,
	);

	const tunnel = new Tunnel(instanceId, serviceId);
	tunnel.start(VPN_CONNECT_PROXY_PORT);
	return tunnel;
};
export default worker;
