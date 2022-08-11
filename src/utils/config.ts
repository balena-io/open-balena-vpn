/*
	Copyright (C) 2020 Balena Ltd.

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

import * as fs from 'fs';
import * as os from 'os';

const requiredVar = (varName: string): string => {
	const s = process.env[varName];
	if (s == null) {
		process.exitCode = 1;
		throw new Error(`Missing environment variable: ${varName}`);
	}
	return s;
};

export function optionalVar(varName: string, defaultValue: string): string;
export function optionalVar(
	varName: string,
	defaultValue?: string,
): string | undefined;
export function optionalVar(
	varName: string,
	defaultValue?: string,
): string | undefined {
	return process.env[varName] || defaultValue;
}

const requiredMultiVar = (...varNames: string[]): string => {
	let s: string | undefined;
	for (const varName of varNames) {
		s = optionalVar(varName);
		if (s != null) {
			break;
		}
	}
	if (s == null) {
		process.exitCode = 1;
		throw new Error(
			`Must have at least one of the following environment variables: '${varNames.join(
				"', '",
			)}'`,
		);
	}
	return s;
};

// Code copied from our open source API
// https://github.com/balena-io/open-balena-api/blob/e9abe8f959c59bbeefcadbfdc59642af565b1427/src/lib/config.ts
export function intVar(varName: string): number;
export function intVar<R>(varName: string, defaultValue: R): number | R;
export function intVar<R>(varName: string, defaultValue?: R): number | R {
	if (arguments.length === 1) {
		requiredVar(varName);
	}

	const s = process.env[varName];
	if (s == null) {
		return defaultValue!;
	}
	const i = parseInt(s, 10);
	if (!Number.isFinite(i)) {
		throw new Error(`${varName} must be a valid number if set`);
	}
	return i;
}

// resolve number of workers based on number of CPUs assigned to pods or available CPUs
const getInstanceCount = (varName: string) => {
	let instanceCount = intVar(varName, null);
	if (instanceCount != null && instanceCount > 0) {
		return instanceCount;
	}
	try {
		instanceCount = parseInt(
			fs.readFileSync('/etc/podinfo/cpu_request', 'utf8'),
			10,
		);
		console.log(`Using pod info core count of: ${instanceCount}`);
	} catch (err) {
		instanceCount = os.cpus().length;
		console.log('Could not find pod info for cpu count:', err);
		console.log(`Defaulting to all cores: ${instanceCount}`);
	}
	return instanceCount;
};

const getIPv4InterfaceInfo = (iface?: string): os.NetworkInterfaceInfo[] => {
	return Object.entries(os.networkInterfaces())
		.filter(([nic]) => nic === iface)
		.flatMap(([, ips]) => ips || [])
		.filter((ip) => !ip.internal && ip.family === 'IPv4');
};

const { TRUST_PROXY: trustProxy = 'true' } = process.env;
let trustProxyValue;
if (trustProxy === 'true') {
	// If it's 'true' enable it
	trustProxyValue = true;
} else if (trustProxy.includes('.') || trustProxy.includes(':')) {
	// If it looks like an ip use as-is
	trustProxyValue = trustProxy;
} else {
	const trustProxyNum = parseInt(trustProxy, 10);
	if (Number.isFinite(trustProxyNum)) {
		// If it's a number use the number
		trustProxyValue = trustProxyNum;
	} else {
		throw new Error(`Invalid value for 'TRUST_PROXY' of '${trustProxy}'`);
	}
}
export const TRUST_PROXY = trustProxyValue;

export const VPN_API_PORT = intVar('VPN_API_PORT');

// milliseconds
export const DEFAULT_SIGTERM_TIMEOUT = intVar('DEFAULT_SIGTERM_TIMEOUT') * 1000;

export const VPN_INSTANCE_COUNT = getInstanceCount('VPN_INSTANCE_COUNT');
export const VPN_VERBOSE_LOGS = process.env.DEFAULT_VERBOSE_LOGS === 'true';

export const VPN_SERVICE_ADDRESS = getIPv4InterfaceInfo(
	process.env.VPN_SERVICE_REGISTER_INTERFACE,
)?.[0]?.address;

export const { VPN_GATEWAY } = process.env;
const VPN_BASE_SUBNET = requiredVar('VPN_BASE_SUBNET');
export const [VPN_BASE_IP, netMask] = VPN_BASE_SUBNET.split('/');
export const VPN_BASE_MASK = parseInt(netMask, 10);

export const VPN_INSTANCE_SUBNET_BITMASK = Math.max(
	// Clamp the largest subnet as /16 because that's as high as openvpn accepts
	16,
	intVar(
		'VPN_INSTANCE_SUBNET_BITMASK',
		// Default to assigning as much of the subnet per openvpn process as possible
		VPN_BASE_MASK + Math.ceil(Math.log2(VPN_INSTANCE_COUNT)),
	),
);
export const VPN_BASE_PORT = intVar('VPN_BASE_PORT');
export const VPN_BASE_MANAGEMENT_PORT = intVar('VPN_BASE_MANAGEMENT_PORT');

// disable bytecount reporting by default
export const VPN_BYTECOUNT_INTERVAL = intVar('VPN_BYTECOUNT_INTERVAL', 0);

const apiHostForInternalUse = requiredMultiVar(
	'BALENA_API_INTERNAL_HOST',
	'BALENA_API_HOST',
);
// If we're using a dedicated internal host then we use http, if it's a shared external one it needs to be https
export const BALENA_API_INTERNAL_HOST =
	apiHostForInternalUse === optionalVar('BALENA_API_INTERNAL_HOST')
		? `http://${apiHostForInternalUse}`
		: `https://${apiHostForInternalUse}`;

export const VPN_SERVICE_API_KEY = Buffer.from(
	requiredVar('VPN_SERVICE_API_KEY'),
);
export const VPN_CONNECT_PROXY_PORT = intVar('VPN_CONNECT_PROXY_PORT');
export const VPN_FORWARD_PROXY_PORT = intVar('VPN_FORWARD_PROXY_PORT');

export const VPN_AUTH_CACHE_TIMEOUT = intVar(
	'VPN_AUTH_CACHE_TIMEOUT',
	1 * 60 * 1000,
);
