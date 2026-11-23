/*
	Copyright (C) 2026 Balena Ltd.

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

import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import net from 'node:net';

import { Tunnel } from '../../src/proxy-worker.ts';
import { apiHostname, mockApi } from '../mock-api.ts';

const serviceId = 1;
const otherServiceId = 2;
let nextDeviceId = 100000;

// Every test uses its own device, so that its API mocks and `canAccessDevice`'s cache don't
// affect other tests
const mockDevice = async ({
	accessible = true,
	vpnServiceId = otherServiceId,
	onVpnHostLookup = () => {
		// nothing
	},
} = {}) => {
	const uuid = randomBytes(16).toString('hex');
	const id = nextDeviceId++;
	await mockApi
		.forPost('/v7/device(uuid=@uuid)/canAccess')
		.forHostname(apiHostname)
		.withQuery({ '@uuid': `'${uuid}'` })
		.thenJson(200, { d: accessible ? [{ id }] : [] });
	await mockApi
		.forGet('/v7/device(@id)')
		.forHostname(apiHostname)
		.withQuery({ $select: 'id', $filter: 'is_connected_to_vpn', '@id': id })
		.thenJson(200, { d: [{ id }] });
	await mockApi
		.forGet('/v7/service_instance')
		.forHostname(apiHostname)
		.matching((req) => decodeURIComponent(req.url).includes(`'${uuid}'`))
		.thenCallback(() => {
			onVpnHostLookup();
			return {
				statusCode: 200,
				json: { d: [{ id: vpnServiceId, ip_address: '127.0.0.1' }] },
			};
		});
	return uuid;
};

const listen = async (server: net.Server) => {
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return (server.address() as net.AddressInfo).port;
};

// Reads an HTTP response head, leaving anything after it unread on the socket
const readResponse = (socket: net.Socket) =>
	new Promise<{ statusLine: string; head: string }>((resolve, reject) => {
		let received = Buffer.alloc(0);
		const onData = (chunk: Buffer) => {
			received = Buffer.concat([received, chunk]);
			const headEnd = received.indexOf('\r\n\r\n');
			if (headEnd === -1) {
				return;
			}
			socket.off('data', onData).off('end', onEnd).off('error', reject);
			socket.pause();
			const rest = received.subarray(headEnd + 4);
			if (rest.length > 0) {
				socket.unshift(rest);
			}
			const head = received.toString('latin1', 0, headEnd);
			resolve({ statusLine: head.split('\r\n', 1)[0], head });
		};
		const onEnd = () => {
			reject(
				new Error(
					`connection ended before a complete response: ${JSON.stringify(received.toString('latin1'))}`,
				),
			);
		};
		socket.on('data', onData).on('end', onEnd).on('error', reject);
	});

const readBytes = (socket: net.Socket, length: number) =>
	new Promise<Buffer>((resolve, reject) => {
		let received = Buffer.alloc(0);
		const onData = (chunk: Buffer) => {
			received = Buffer.concat([received, chunk]);
			if (received.length >= length) {
				socket.off('data', onData).off('error', reject);
				resolve(received);
			}
		};
		socket.on('data', onData).on('error', reject).resume();
	});

export default () => {
	let tunnel: Tunnel;
	let proxyServer: net.Server;
	let proxyPort: number;
	// The vpn instance that tunnels are forwarded to; each test sets how it answers
	let fakeVpn: net.Server;
	let onForwardedConnect: (socket: net.Socket, request: string) => void;
	const sockets = new Set<net.Socket>();

	// A single tunnel for every test, because each `Tunnel`'s logger adds an 'uncaughtException'
	// listener to the process that is never removed
	before(async () => {
		fakeVpn = net.createServer((socket) => {
			sockets.add(socket);
			socket.on('error', () => {
				// ignore
			});
			let request = '';
			const onData = (chunk: Buffer) => {
				request += chunk.toString('latin1');
				if (request.includes('\r\n\r\n')) {
					socket.off('data', onData);
					onForwardedConnect(socket, request);
				}
			};
			socket.on('data', onData);
		});
		const forwardProxyPort = await listen(fakeVpn);
		tunnel = new Tunnel(0, serviceId, { forwardProxyPort });
		proxyServer = tunnel.listen(0, '127.0.0.1');
		proxyServer.on('connection', (socket: net.Socket) => sockets.add(socket));
		await once(proxyServer, 'listening');
		proxyPort = (proxyServer.address() as net.AddressInfo).port;
	});

	beforeEach(() => {
		onForwardedConnect = (vpnSocket) => {
			vpnSocket.destroy();
		};
	});

	afterEach(() => {
		for (const socket of sockets) {
			socket.destroy();
		}
		sockets.clear();
	});

	after(() => {
		proxyServer.close();
		fakeVpn.close();
	});

	const connectToProxy = async (
		target: string,
		{ allowHalfOpen = false } = {},
	) => {
		const socket = net.connect({
			port: proxyPort,
			host: '127.0.0.1',
			allowHalfOpen,
		});
		sockets.add(socket);
		socket.on('error', () => {
			// ignore
		});
		await once(socket, 'connect');
		socket.write(`CONNECT ${target} HTTP/1.0\r\n\r\n`);
		return socket;
	};

	describe('rejected requests', () => {
		it('should respond 403 to a hostname that is not a device', async () => {
			const socket = await connectToProxy('example.com:80');
			const { statusLine } = await readResponse(socket);
			expect(statusLine).to.equal('HTTP/1.0 403 Forbidden');
		});

		it('should respond 407 for a device that is not accessible', async () => {
			const uuid = await mockDevice({ accessible: false });
			const socket = await connectToProxy(`${uuid}.balena:22`);
			const { statusLine } = await readResponse(socket);
			expect(statusLine).to.equal('HTTP/1.0 407 Proxy Authorization Required');
		});

		it('should close the connection after responding, even if the client keeps it open', async () => {
			const accepted = once(proxyServer, 'connection');
			// a node client ends its side as soon as the server does unless it allows half-open sockets
			const socket = await connectToProxy('example.com:80', {
				allowHalfOpen: true,
			});
			const [serverSocket] = (await accepted) as [net.Socket];
			const closed = once(serverSocket, 'close');
			await readResponse(socket);
			await closed;
		});

		it('should close the connection after responding when the client sent more data', async () => {
			const uuid = await mockDevice({ accessible: false });
			const accepted = once(proxyServer, 'connection');
			const socket = await connectToProxy(`${uuid}.balena:22`);
			const [serverSocket] = (await accepted) as [net.Socket];
			const closed = once(serverSocket, 'close');
			// more than the socket's highWaterMark, which nothing reads
			socket.write(Buffer.alloc(200 * 1024));
			socket.end();
			await closed;
		});
	});

	describe('forwarding to another vpn instance', () => {
		it('should tunnel to the device through the instance it is connected to', async () => {
			const uuid = await mockDevice();
			let forwardedRequest: string | undefined;
			onForwardedConnect = (vpnSocket, request) => {
				forwardedRequest = request;
				vpnSocket.write('HTTP/1.0 200 Connection Established\r\n\r\n');
				// echo, as the device
				vpnSocket.pipe(vpnSocket);
			};

			const socket = await connectToProxy(`${uuid}.balena:22`);
			const { statusLine } = await readResponse(socket);
			expect(statusLine).to.equal('HTTP/1.0 200 Connection Established');
			expect(forwardedRequest).to.match(
				new RegExp(`^CONNECT ${uuid}\\.balena:22 HTTP/1\\.0\\r\\n`),
			);
			expect(forwardedRequest).to.include(
				`\r\nForwarded: By=open-balena-vpn(${serviceId})\r\n`,
			);

			socket.write('ping');
			const echoed = await readBytes(socket, 4);
			expect(echoed.toString()).to.equal('ping');
		});

		it('should respond 500 when the other instance refuses the tunnel', async () => {
			const uuid = await mockDevice();
			onForwardedConnect = (vpnSocket) => {
				vpnSocket.end('HTTP/1.0 503 Service Unavailable\r\n\r\n');
			};

			const socket = await connectToProxy(`${uuid}.balena:22`);
			const { statusLine } = await readResponse(socket);
			expect(statusLine).to.equal('HTTP/1.0 500 Internal Server Error');
		});
	});

	describe('forwarding loops', () => {
		// a second instance, which forwards tunnels to the first; created once for the same reason as
		// the first
		let otherServer: net.Server;
		let otherPort: number;
		before(async () => {
			const otherTunnel = new Tunnel(1, otherServiceId, {
				forwardProxyPort: proxyPort,
			});
			otherServer = otherTunnel.listen(0, '127.0.0.1');
			otherServer.on('connection', (conn: net.Socket) => sockets.add(conn));
			await once(otherServer, 'listening');
			otherPort = (otherServer.address() as net.AddressInfo).port;
		});

		after(() => {
			otherServer.close();
		});

		it('should respond 500 when another instance would forward the tunnel back', async () => {
			// both instances think the device is on a third instance, so each forwards to the other
			let lookups = 0;
			const loop: PromiseWithResolvers<never> = Promise.withResolvers();
			const uuid = await mockDevice({
				vpnServiceId: 3,
				onVpnHostLookup: () => {
					if (++lookups > 4) {
						loop.reject(new Error('the tunnel request kept being forwarded'));
					}
				},
			});
			// relay what this instance forwards to the other instance
			onForwardedConnect = (vpnSocket, request) => {
				const relay = net.connect(otherPort, '127.0.0.1');
				sockets.add(relay);
				relay.on('error', () => {
					vpnSocket.destroy();
				});
				relay.write(request);
				vpnSocket.pipe(relay).pipe(vpnSocket);
			};

			const socket = await connectToProxy(`${uuid}.balena:22`);
			const { statusLine } = await Promise.race([
				readResponse(socket),
				loop.promise,
			]);
			expect(statusLine).to.equal('HTTP/1.0 500 Internal Server Error');
			// this instance, the other instance, then this instance again, which detects the loop
			expect(lookups).to.equal(3);
		});

		it("should keep the client's Forwarded header when forwarding", async () => {
			const uuid = await mockDevice();
			const forwarded: PromiseWithResolvers<string> = Promise.withResolvers();
			onForwardedConnect = (vpnSocket, request) => {
				forwarded.resolve(request);
				vpnSocket.destroy();
			};

			const socket = net.connect(proxyPort, '127.0.0.1');
			sockets.add(socket);
			socket.on('error', () => {
				// ignore
			});
			await once(socket, 'connect');
			socket.write(
				`CONNECT ${uuid}.balena:22 HTTP/1.0\r\nForwarded: for=client\r\nForwarded: by=other\r\n\r\n`,
			);
			expect(await forwarded.promise).to.include(
				`\r\nForwarded: for=client, by=other,By=open-balena-vpn(${serviceId})\r\n`,
			);
		});
	});
};
