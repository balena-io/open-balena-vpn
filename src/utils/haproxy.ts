/*
	Copyright (C) 2019 Balena Ltd.

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

import net from 'net';

export class HAProxy {
	private sockPath: string;

	constructor(sockPath: string) {
		this.sockPath = sockPath;
	}

	protected async connect(): Promise<net.Socket> {
		return await new Promise((resolve, reject) => {
			const socket = net.createConnection(this.sockPath);
			socket.on('connect', () => {
				resolve(socket);
			});
			socket.on('error', reject);
		});
	}

	private async send(command: string): Promise<string> {
		const socket = await this.connect();
		return await new Promise((resolve, reject) => {
			let response = '';
			socket.setEncoding('utf8');
			socket.on('data', (chunk: string) => {
				response += chunk;
			});
			socket.on('end', () => {
				resolve(response.trim());
			});
			socket.on('error', reject);
			socket.end(`${command}\n`);
		});
	}

	public async register(
		name: string,
		port: number,
		host = '127.0.0.1',
	): Promise<boolean> {
		const preamble = `set server ${name}`;
		await this.send(
			`${preamble} addr ${host} port ${port}; ${preamble} state ready`,
		);
		return true;
	}

	public async drain(name: string): Promise<boolean> {
		await this.send(`set server ${name} state drain`);
		return true;
	}
}
