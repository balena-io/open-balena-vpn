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

declare module 'telnet-openvpn' {
	import Telnet = require('telnet-client');

	interface OpenVpnData {
		state?: string[];
		hold?: unknown;
		success?: unknown;
		bytecount?: string[];
		bytecount_cli?: string[];
		password?: unknown;
		pid?: number;
	}

	type ConnectCallback = () => void;
	type LogCallback = (data: string) => void;
	type DataCallback = (data: OpenVpnData) => void;

	declare class TelnetOpenVPN extends NodeJS.EventEmitter {
		public connection: Telnet;
		public connect = Telnet.connect;
		public exec(command): PromiseLike<void>;
		public on(event: 'connect', callback?: ConnectCallback): void;
		public on(event: 'log', callback?: LogCallback): void;
		public on(event: 'data', callback?: DataCallback): void;
		public removeListener(event: 'log', callback: LogCallback);
	}

	export = TelnetOpenVPN;
}
