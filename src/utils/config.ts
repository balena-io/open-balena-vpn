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
import fs from 'fs';
import os from 'os';

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
		.flatMap(([, ips]) => ips ?? [])
		.filter((ip) => !ip.internal && ip.family === 'IPv4');
};

export const TRUST_PROXY = trustProxyVar('TRUST_PROXY', false);

export const VPN_API_PORT = intVar('VPN_API_PORT');

export const VPN_STATUS_FILE_WRITE_INTERVAL_SECONDS = intVar(
	'VPN_STATUS_FILE_WRITE_INTERVAL_SECONDS',
	10,
);

// Bandwidth throttling configuration with validation
export const VPN_DOWNRATE = optionalVar('VPN_DOWNRATE');
export const VPN_UPRATE = optionalVar('VPN_UPRATE');

// Validate rate format if specified
if (VPN_DOWNRATE && !/^\d+(kbit|mbit|gbit)$/.test(VPN_DOWNRATE)) {
	throw new Error('VPN_DOWNRATE must be in format: <number>(kbit|mbit|gbit)');
}
if (VPN_UPRATE && !/^\d+(kbit|mbit|gbit)$/.test(VPN_UPRATE)) {
	throw new Error('VPN_UPRATE must be in format: <number>(kbit|mbit|gbit)');
}
if ((VPN_DOWNRATE != null) !== (VPN_UPRATE != null)) {
	throw new Error(
		'You must either specify both or neither of VPN_UPRATE and VPN_DOWNRATE, specifying just one is not supported',
	);
}

// Learn-address script configuration
export const LEARN_ADDRESS_DEBUG = boolVar('LEARN_ADDRESS_DEBUG', false);
export const LEARN_ADDRESS_STATE_DIR = optionalVar(
	'LEARN_ADDRESS_STATE_DIR',
	'/var/lib/openvpn/tc-state',
);

export const LEARN_ADDRESS_LOG_DIR = optionalVar(
	'LEARN_ADDRESS_LOG_DIR',
	'/var/log/openvpn',
);

export const METRICS_TIMEOUT = intVar('METRICS_TIMEOUT', 20 * SECONDS);

// milliseconds
export const DEFAULT_SIGTERM_TIMEOUT =
	intVar('DEFAULT_SIGTERM_TIMEOUT') * SECONDS;
// We convert the drain rate per minute to the equivalent max delay for ease of use elsewhere
export const MAXIMUM_DRAIN_DELAY = Math.round(
	(1 * MINUTES) / intVar('MINIMUM_DRAIN_RATE_PER_MINUTE', 500),
);

export const VPN_INSTANCE_COUNT = getInstanceCount('VPN_INSTANCE_COUNT');
const VPN_OPENVPN_PROTO = optionalVar('VPN_OPENVPN_PROTO');
if (VPN_OPENVPN_PROTO) {
	if (/^udp[4-6]?$/.test(VPN_OPENVPN_PROTO)) {
		if (VPN_INSTANCE_COUNT > 1) {
			throw new Error(
				`Can not set VPN_INSTANCE_COUNT to ${VPN_INSTANCE_COUNT} if VPN_OPENVPN_PROTO is ${VPN_OPENVPN_PROTO}.`,
			);
		}
	}
}

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

export const DELAY_ON_AUTH_FAIL = intVar('DELAY_ON_AUTH_FAIL', 10 * SECONDS);
