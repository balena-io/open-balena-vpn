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

import { getLogger } from './utils/index.ts';
import {
	VPN_CONNECT_PROXY_PORT,
	VPN_FORWARD_PROXY_PORT,
	VPN_FORWARD_PROXY_TIMEOUT,
	VPN_PROXY_IDLE_TIMEOUT,
	VPN_PROXY_KEEPALIVE_DELAY,
	VPN_SERVICE_API_KEY,
	VPN_STATUS_FILE_WRITE_INTERVAL_SECONDS,
} from './utils/config.ts';
import * as errors from './utils/errors.ts';
import { Metrics } from './utils/metrics.ts';
import {
	canAccessDevice,
	isDeviceConnectedToVpn,
	getDeviceVpnHost,
} from './utils/device.ts';
import { context, propagation, trace } from '@opentelemetry/api';
import { setTimeout } from 'timers/promises';

const HTTP_500 = 'HTTP/1.0 500 Internal Server Error\r\n\r\n';

const deviceIsLocal = async (uuid: string) => {
	try {
		await dns.lookup(`${uuid}.vpn`);
		return true;
	} catch {
		return false;
	}
};

export class Tunnel extends nodeTunnel.Tunnel {
	private readonly logger: winston.Logger;
	private readonly instanceId: number;
	private readonly serviceId: number;
	private readonly forwardProxyPort: number;

	constructor(
		instanceId: number,
		serviceId: number,
		{ forwardProxyPort = VPN_FORWARD_PROXY_PORT } = {},
	) {
		super();
		this.instanceId = instanceId;
		this.serviceId = serviceId;
		this.forwardProxyPort = forwardProxyPort;
		this.logger = getLogger('proxy', this.serviceId, this.instanceId);

		this.on('error', (err) => {
			// errors thrown in `this.connect` will appear here
			if (!(err instanceof errors.HandledTunnelingError)) {
				this.logger.crit(`failed to connect to device: ${err}`);
				errors.captureException(err, 'proxy-connect-error');
			}
		});

		const tunnelTracer = trace.getTracer('node-tunnel');
		this.use(async (...args) => {
			const [req, cltSocket] = args;
			// The http server removes its own 'error' listener when it hands over a CONNECT socket and
			// node-tunnel only adds one once the tunnel is established, so without this a client resetting
			// the connection during setup is an uncaughtException, which makes the vpn worker drain and exit
			cltSocket.on('error', (err) => {
				this.logger.debug(`client socket error: ${err.message}`);
			});
			const extractedContext = propagation.extract(
				context.active(),
				req.headers,
			);

			await tunnelTracer.startActiveSpan(
				req.method ?? 'Unknown',
				{},
				extractedContext,
				async (span) => {
					try {
						await this.tunnelToDevice(...args);
					} finally {
						span.end();
					}
				},
			);
		});
	}

	private async localConnect(
		port: number,
		host: string,
		client: net.Socket,
		req: nodeTunnel.Request,
	) {
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
	}

	public connect = async (
		port: number,
		host: string,
		client: net.Socket,
		req: nodeTunnel.Request,
	) => {
		const socket = await this.connectToDevice(port, host, client, req);
		// node-tunnel only starts listening for the client's 'end'/'error' once we return, so if the
		// client went away during setup those events have already fired and the tunnel would never be
		// torn down, leaking both sockets
		if (client.destroyed || client.readableEnded) {
			socket.destroy();
			throw new errors.HandledTunnelingError(
				'client disconnected during tunnel setup',
			);
		}
		for (const s of [client, socket]) {
			s.setKeepAlive(true, VPN_PROXY_KEEPALIVE_DELAY);
			if (VPN_PROXY_IDLE_TIMEOUT > 0) {
				// Destroy with an error as node-tunnel only tears down the tunnel on 'end'/'error'
				s.setTimeout(VPN_PROXY_IDLE_TIMEOUT, () => {
					s.destroy(new errors.HandledTunnelingError('tunnel idle timeout'));
				});
			}
		}
		return socket;
	};

	private connectToDevice = async (
		port: number,
		host: string,
		client: net.Socket,
		req: nodeTunnel.Request,
	) => {
		const { uuid, auth } = this.parseRequest(req);

		try {
			if (await deviceIsLocal(uuid)) {
				return await this.localConnect(port, host, client, req);
			} else {
				const vpnHost = await getDeviceVpnHost(uuid, auth);
				if (vpnHost == null) {
					client.end(HTTP_500);
					throw new errors.HandledTunnelingError(
						'service instance not found for device',
					);
				}
				if (vpnHost === false || vpnHost.id === this.serviceId) {
					// If we could not look up the alternate VPN host, or if the looked up VPN host is the same as the current then we should
					// retry after a delay to allow time for the status file to be updated, handling the case that the previous failure to find
					// the device locally was due to a race condition where the status file had not yet been updated. We match the delay to the
					// interval for writing the VPN status file to ensure it definitely has enough time to be updated, however it would be possible
					// to use a shorter delay/more retries to improve responsiveness.
					await setTimeout(VPN_STATUS_FILE_WRITE_INTERVAL_SECONDS * 1000);
					if (await deviceIsLocal(uuid)) {
						return await this.localConnect(port, host, client, req);
					}
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
				return await this.forwardRequest(
					vpnHost.ip_address,
					uuid,
					port,
					req.headers.forwarded,
					auth,
				);
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

		const match = /^([a-fA-F0-9]+)\.(balena|resin|vpn)(?::([0-9]+))?$/.exec(
			req.url,
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

	private tunnelToDevice = (async (req, cltSocket, _head, next) => {
		try {
			const { uuid, port, auth } = this.parseRequest(req);
			this.logger.info(`tunnel requested to ${uuid}:${port}`);

			const deviceId = await canAccessDevice(uuid, port, auth);
			if (!deviceId) {
				cltSocket.end('HTTP/1.0 407 Proxy Authorization Required\r\n\r\n');
				throw new errors.HandledTunnelingError(
					`device not accessible: ${uuid}`,
				);
			}
			// we need to use VPN_SERVICE_API_KEY here as this could be an unauthenticated request
			const isConnectedToVpn = await isDeviceConnectedToVpn(
				deviceId,
				VPN_SERVICE_API_KEY,
			);
			if (!isConnectedToVpn) {
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
				errors.captureException(err, 'proxy-tunnel-error');
				cltSocket.end(HTTP_500);
			}
			// node-tunnel never sees this request as `next` isn't called, and the server allows
			// half-open sockets that nothing reads, so close it ourselves once the response is sent
			cltSocket.destroySoon();
		}
	}) satisfies nodeTunnel.Middleware;

	private forwardRequest = (
		vpnHost: string,
		uuid: string,
		port: number,
		forwarded: string,
		proxyAuth?: Buffer,
	): Promise<net.Socket> =>
		new Promise((resolve, reject) => {
			let tunnelProxyResponse = '';
			const socket: net.Socket = net.connect(
				this.forwardProxyPort,
				vpnHost,
				() => {
					socket.write(`CONNECT ${uuid}.balena:${port} HTTP/1.0\r\n`);
					// lets the next instance detect a loop if it would forward the request back; latin1 is how
					// node decoded the client's header, so its bytes pass through unchanged
					socket.write(`Forwarded: ${forwarded}\r\n`, 'latin1');
					if (proxyAuth != null) {
						socket.write(
							`Proxy-Authorization: Basic ${proxyAuth.toString('base64')}\r\n`,
						);
					}
					socket.write('\r\n');
				},
			);
			socket.setTimeout(VPN_FORWARD_PROXY_TIMEOUT, () => {
				socket.destroy(
					new Error(`timed out waiting for ${vpnHost} to accept the tunnel`),
				);
			});

			const earlyEnd = () => {
				socket.destroy();
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
				errors.captureException(err, 'proxy-forward-error');
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
					// The error listener has already been removed so the socket must be closed here, both so it
					// doesn't stay open and so a later error on it is not an uncaughtException
					socket.destroy();
					reject(
						new errors.RemoteTunnellingError(
							`could not connect to ${uuid}:${port}: ${httpStatusLine}`,
						),
					);
					return;
				}
				socket.setTimeout(0);
				resolve(socket);
			};

			socket.on('end', earlyEnd).on('error', earlyError).on('data', proxyData);
		});
}

const worker = (instanceId: number, serviceId: number) => {
	getLogger('proxy', serviceId, instanceId).info(
		`process started with pid=${process.pid}`,
	);

	new Tunnel(instanceId, serviceId).start(VPN_CONNECT_PROXY_PORT);
};
export default worker;
