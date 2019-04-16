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

import * as Bluebird from 'bluebird';
import * as net from 'net';

export class HAProxy {
	constructor(private sockPath: string) {}

	protected connect(): Bluebird<net.Socket> {
		return new Bluebird((resolve, reject) => {
			const socket = net.createConnection(this.sockPath);
			socket.on('connect', () => resolve(socket));
			socket.on('error', reject);
		});
	}

	public register(
		name: string,
		port: number,
		host: string = '127.0.0.1',
	): Bluebird<boolean> {
		const preamble = `set server ${name}`;
		return this.connect()
			.then(socket => {
				socket.write(
					`${preamble} addr ${host} port ${port}\r\n${preamble} state ready\r\n`,
					() => {
						socket.destroy();
					},
				);
			})
			.return(true);
	}
}
