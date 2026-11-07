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
import 'mocha';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { HAProxy } from '../../src/utils/haproxy.ts';

const startFakeCli = async (replyDelayMs = 50) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haproxy-cli-'));
	const sockPath = path.join(dir, 'haproxy.sock');
	const executed: string[] = [];
	const server = net.createServer({ allowHalfOpen: true }, (socket) => {
		let buffer = '';
		socket.setEncoding('utf8');
		socket.on('data', (chunk: string) => {
			buffer += chunk;
			const newline = buffer.indexOf('\n');
			if (newline === -1) {
				return;
			}
			const line = buffer.slice(0, newline);
			setTimeout(() => {
				executed.push(line);
				socket.end('\n');
			}, replyDelayMs);
		});
		socket.on('error', () => undefined);
	});
	await new Promise<void>((resolve) => {
		server.listen(sockPath, resolve);
	});
	const close = async () => {
		await new Promise<void>((resolve) => {
			server.close(() => {
				resolve();
			});
		});
		fs.rmSync(dir, { recursive: true, force: true });
	};
	return { sockPath, executed, close };
};

export default () => {
	describe('HAProxy', () => {
		it('registers a server with a newline-terminated command and waits for the reply', async () => {
			const cli = await startFakeCli();
			try {
				await new HAProxy(cli.sockPath).register('vpn-workers/vpn1', 10001);
				expect(cli.executed).to.deep.equal([
					'set server vpn-workers/vpn1 addr 127.0.0.1 port 10001; set server vpn-workers/vpn1 state ready',
				]);
			} finally {
				await cli.close();
			}
		});

		it('drains a server with a newline-terminated command and waits for the reply', async () => {
			const cli = await startFakeCli();
			try {
				await new HAProxy(cli.sockPath).drain('vpn-workers/vpn1');
				expect(cli.executed).to.deep.equal([
					'set server vpn-workers/vpn1 state drain',
				]);
			} finally {
				await cli.close();
			}
		});
	});
};
