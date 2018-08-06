declare module 'openvpn-client' {
	export type VpnOpts = string[];

	export class OpenVPNClient {
		constructor(vpnOpts?: VpnOpts);

		authenticate(user: string, pass: string): void;
		connect(callback: () => void): Promise<any>;
		disconnect(): Promise<void>;

		on(event: 'data', callback: (data: Buffer) => void): this;
		on(event: 'connect', callback: () => void): this;
		on(event: 'disconnect', callback: (code: number) => void): this;
	}

	export const create: (vpnOpts?: VpnOpts) => OpenVPNClient;
	export const connect: (auth?: {user: string, pass: string}, vpnOpts?: VpnOpts) => OpenVPNClient;
}
