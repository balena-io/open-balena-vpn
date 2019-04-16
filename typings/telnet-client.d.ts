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

declare module 'telnet-client' {
	import { EventEmitter } from 'events';

	export declare interface TelnetConnectOptions {
		port?: number | string;
		shellPrompt?: string;
	}

	declare interface Telnet extends EventEmitter {
		on(event: 'data', callback?: (data: Buffer) => void): this;
		on(event: 'connect' | 'close' | 'end', callback?: () => void): this;
		on(event: 'error', callback?: (err: Error) => void): this;
	}

	declare class Telnet {
		public connect(options: TelnetConnectOptions): Bluebird<void>;
		public send(command: string): Bluebird<Buffer>;
	}

	export = Telnet;
}
