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

import * as _ from 'lodash';
import * as memoize from 'memoizee';

import { balenaApi } from '.';
import { APIError, captureException } from './errors';

const { VPN_GUEST_API_KEY } = process.env;

const authHeader = (auth?: Buffer): { Authorization?: string } => {
	const headers: { Authorization?: string } = {};
	if (auth != null) {
		headers.Authorization = `Bearer ${auth}`;
	} else if (VPN_GUEST_API_KEY != null) {
		headers.Authorization = `Bearer ${VPN_GUEST_API_KEY}`;
	}
	return headers;
};

export interface DeviceInfo {
	id: number;
	is_connected_to_vpn: boolean;
}

const getDeviceByUUIDQuery = balenaApi.prepare<{ uuid: string }>({
	resource: 'device',
	options: {
		$select: ['id', 'is_connected_to_vpn'],
		$filter: {
			uuid: { '@': 'uuid' },
		},
	},
});
export const getDeviceByUUID = async (
	uuid: string,
	auth?: Buffer,
): Promise<DeviceInfo> => {
	try {
		const devices = await getDeviceByUUIDQuery({ uuid }, undefined, {
			headers: authHeader(auth),
		});
		if (!_.isArray(devices) || devices.length === 0) {
			throw new Error('invalid api response');
		}
		return devices[0] as DeviceInfo;
	} catch (err) {
		captureException(err, 'device-lookup-error');
		throw new APIError(err.message);
	}
};

const canAccessDeviceQuery = balenaApi.prepare<{ id: number }>({
	method: 'POST',
	resource: 'device',
	id: { '@': 'id' },
	url: `device(@id)/canAccess`,
});
const $canAccessDevice = async (
	device: DeviceInfo,
	port: number,
	auth?: Buffer,
) => {
	try {
		const { d }: { d?: Array<{ id: number }> } = await canAccessDeviceQuery(
			{ id: device.id },
			{
				action: { or: ['tunnel-any', `tunnel-${port}`] },
			},
			{ headers: authHeader(auth) },
		);
		return _.isArray(d) && d.length === 1 && d[0].id === device.id;
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
): Promise<VpnHost> => {
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
			passthrough: { headers: authHeader(auth) },
		});
		if (!_.isArray(services) || services.length === 0) {
			throw new Error('invalid api response');
		}
		return services[0] as VpnHost;
	} catch (err) {
		captureException(err, 'device-vpn-host-lookup-error');
		throw new APIError(`cannot find device vpn host (${err.message})`);
	}
};
