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
import { once } from 'events';
import fs from 'fs';
import net from 'net';
import 'mocha';

import { Netmask } from '../../src/utils/netmask.ts';
import { TimeoutError } from 'p-timeout';
import { probePort, VpnManager } from '../../src/utils/openvpn.ts';

const HOST = '127.0.0.1';
const PORT_RANGE_FILE = '/proc/sys/net/ipv4/ip_local_port_range';
const PROBE_DURATION_MS = 5000;
/** Linux connect() tries source ports in steps of 2, so all share one parity. */
const CONNECT_PORT_STRIDE = 2;
const SUBNET = new Netmask('100.64.0.0', 20);

const listen = async (port: number) => {
	const server = net
		.createServer((socket) => {
			socket.on('error', () => {
				// probePort() closes with a reset
			});
		})
		.listen(port, HOST);
	await once(server, 'listening');
	return server;
};

const close = async (server: net.Server) => {
	server.close();
	await once(server, 'close');
};

/**
 * Returns a free port that Linux connect() can select as a source port.
 * Linux connect() starts at the low bound plus an even offset, so the port
 * must have the same parity as the low bound.
 */
const findSourcePortCandidate = async () => {
	const [low, high] = fs
		.readFileSync(PORT_RANGE_FILE, 'utf8')
		.trim()
		.split(/\s+/)
		.map(Number);
	for (
		let port = low + CONNECT_PORT_STRIDE;
		port < high;
		port += CONNECT_PORT_STRIDE
	) {
		try {
			await close(await listen(port));
			return port;
		} catch {
			// port in use, try the next one
		}
	}
	throw new Error('no free port in ip_local_port_range');
};

export default () => {
	describe('probePort', () => {
		it('should resolve true when a listener accepts', async () => {
			const server = await listen(0);
			const { port } = server.address() as net.AddressInfo;
			expect(await probePort(port, HOST)).to.equal(true);
			await close(server);
		});

		it('should resolve false when nothing listens, including a self-connect', async function () {
			if (!fs.existsSync(PORT_RANGE_FILE)) {
				this.skip();
			}
			this.timeout(PROBE_DURATION_MS * 2);
			const port = await findSourcePortCandidate();

			// A tight loop: Linux eventually selects `port` as the source port
			// and the SYN connects to itself.
			const deadline = Date.now() + PROBE_DURATION_MS;
			while (Date.now() < deadline) {
				expect(await probePort(port, HOST)).to.equal(false);
			}

			// A self-connect closed without a reset leaves a TIME_WAIT on `port`
			// and openvpn fails with "Address already in use".
			await close(await listen(port));
		});
	});

	describe('waitForStart', () => {
		it('should reject with TimeoutError when the port does not open', async function () {
			this.timeout(PROBE_DURATION_MS * 2);
			const server = await listen(0);
			const { port } = server.address() as net.AddressInfo;
			await close(server);
			const vpn = new VpnManager(99, 0, port, SUBNET);

			let error: unknown;
			try {
				await vpn['waitForStart']();
			} catch (err) {
				error = err;
			}
			expect(error).to.be.instanceOf(TimeoutError);
		});
	});
};
