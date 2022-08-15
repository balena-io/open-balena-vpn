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

import {
	boolVar,
	checkInt,
	intVar,
	MINUTES,
	optionalVar,
	requiredVar,
	SECONDS,
	trustProxyVar,
} from '@balena/env-parsing';
import * as fs from 'fs';
import * as os from 'os';

// resolve number of workers based on number of CPUs assigned to pods or available CPUs
const getInstanceCount = (varName: string) => {
	let instanceCount = intVar(varName, null);
	if (instanceCount != null && instanceCount > 0) {
		return instanceCount;
	}
	try {
		const maybeInstanceCount = checkInt(
			fs.readFileSync('/etc/podinfo/cpu_request', 'utf8'),
		);
		if (maybeInstanceCount == null) {
			throw new Error('/etc/podinfo/cpu_request was not an integer');
		}
		instanceCount = maybeInstanceCount;
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

export const TRUST_PROXY = trustProxyVar('TRUST_PROXY', false);

export const VPN_API_PORT = intVar('VPN_API_PORT');

// milliseconds
export const DEFAULT_SIGTERM_TIMEOUT =
	intVar('DEFAULT_SIGTERM_TIMEOUT') * SECONDS;

export const VPN_INSTANCE_COUNT = getInstanceCount('VPN_INSTANCE_COUNT');
export const VPN_VERBOSE_LOGS = boolVar('DEFAULT_VERBOSE_LOGS');

export const VPN_SERVICE_ADDRESS = getIPv4InterfaceInfo(
	optionalVar('VPN_SERVICE_REGISTER_INTERFACE'),
)?.[0]?.address;

export const VPN_GATEWAY = optionalVar('VPN_GATEWAY');
const VPN_BASE_SUBNET = requiredVar('VPN_BASE_SUBNET');
export const [VPN_BASE_IP, netMask] = VPN_BASE_SUBNET.split('/');
export const maybeVpnBaseMask = checkInt(netMask);
if (maybeVpnBaseMask == null) {
	throw new Error('Invalid VPN_BASE_SUBNET');
}
export const VPN_BASE_MASK = maybeVpnBaseMask;

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

const apiHostForInternalUse = requiredVar([
	'BALENA_API_INTERNAL_HOST',
	'BALENA_API_HOST',
]);
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
	1 * MINUTES,
);

// As of writing this, using a chunk of 8000 62-char UUIDs results a content-length
// that is bellow the 512KiB threshold that would trigger a 413 http error.
export const API_DEVICE_STATE_POST_BATCH_SIZE = intVar(
	'API_DEVICE_STATE_POST_BATCH_SIZE',
	8000,
);
