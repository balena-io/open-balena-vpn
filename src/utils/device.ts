/*
	Copyright (C) 2017 Balena Ltd.

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

import { optionalVar } from '@balena/env-parsing';
import memoize from 'memoizee';

import { balenaApi, getPassthrough, StatusError } from './index.js';
import { APIError, captureException } from './errors.js';

const VPN_GUEST_API_KEY = optionalVar('VPN_GUEST_API_KEY');

const authHeader = (auth?: Buffer): string | undefined => {
	if (auth != null) {
		return `Bearer ${auth}`;
	} else if (VPN_GUEST_API_KEY != null) {
		return `Bearer ${VPN_GUEST_API_KEY}`;
	}
};

export interface DeviceInfo {
	id: number;
	is_connected_to_vpn: boolean;
}

const getDeviceByUUIDQuery = balenaApi.prepare(
	{
		resource: 'device',
		options: {
			$select: ['id', 'is_connected_to_vpn'],
			$filter: {
				uuid: { '@': 'uuid' },
			},
		},
	},
	{ uuid: ['string'] },
);
export const getDeviceByUUID = async (
	uuid: string,
	auth?: Buffer,
): Promise<DeviceInfo> => {
	try {
		const devices = await getDeviceByUUIDQuery(
			{ uuid },
			undefined,
			getPassthrough(authHeader(auth)),
		);
		if (!Array.isArray(devices) || devices.length === 0) {
			throw new Error('invalid api response');
		}
		return devices[0] as DeviceInfo;
	} catch (err) {
		captureException(err, 'device-lookup-error');
		throw new APIError(err.message);
	}
};

const $canAccessDevice = async (
	device: DeviceInfo,
	port: number,
	auth?: Buffer,
) => {
	try {
		const { d } = (await balenaApi.request({
			method: 'POST',
			url: `device(@id)/canAccess?@id=${device.id}`,
			body: {
				action: { or: ['tunnel-any', `tunnel-${port}`] },
			},
			passthrough: getPassthrough(authHeader(auth)),
		})) as { d?: Array<{ id: number }> };
		return Array.isArray(d) && d.length === 1 && d[0].id === device.id;
	} catch {
		return false;
	}
};
export const canAccessDevice = memoize($canAccessDevice, {
	maxAge: 5 * 1000,
	normalizer: (args) => `${args[0].id}-${args[1]}-${args[2] ?? 'guest'}`,
	promise: true,
});

interface VpnHost {
	id: number;
	ip_address: string;
}

export const getDeviceVpnHost = async (
	uuid: string,
	auth?: Buffer,
): Promise<VpnHost | undefined> => {
	try {
		const services = await balenaApi.get({
			resource: 'service_instance',
			options: {
				$select: ['id', 'ip_address'],
				$filter: {
					manages__device: {
						$any: {
							$alias: 'd',
							$expr: { d: { uuid, is_connected_to_vpn: true } },
						},
					},
				},
			},
			passthrough: getPassthrough(authHeader(auth)),
		});
		return services[0];
	} catch (err) {
		if (!(err instanceof StatusError) || err.statusCode !== 401) {
			// Do not capture `Unauthorized` errors
			captureException(err, 'device-vpn-host-lookup-error');
		}
		throw new APIError(`cannot find device vpn host (${err.message})`);
	}
};
