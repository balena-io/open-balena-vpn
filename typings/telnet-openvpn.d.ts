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
	interface OpenVpnConnectOptions {
		port: number;
		shellPrompt: string;
	}

	interface OpenVpnAuthorizeOptions {
		username: string;
		password: string;
	}

	interface OpenVpnData {
		state?: string[];
		hold?: unknown;
		success?: unknown;
		bytecount?: string[];
		bytecount_cli?: string[];
		password?: unknown;
		pid?: number;
	}

	interface OpenVpnConnection {
		shellPrompt: string;
	}

	type ConnectCallback = () => void;
	type LogCallback = (data: string) => void;
	type DataCallback = (data: OpenVpnData) => void;

	declare class TelnetOpenVPN {
		public connect(options: OpenVpnConnectOptions): PromiseLike<string>;
		public exec(command): PromiseLike<void>;
		public on(event: 'connect', callback?: ConnectCallback): void;
		public on(event: 'log', callback?: LogCallback): void;
		public on(event: 'data', callback?: DataCallback): void;
		public removeListener(event: 'log', callback: LogCallback);

		public connection: OpenVpnConnection;
	}

	export = TelnetOpenVPN;
}
