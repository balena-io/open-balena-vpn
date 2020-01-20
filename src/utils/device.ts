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

import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import * as memoize from 'memoizee';

import { balenaApi } from '.';
import { APIError, captureException } from './errors';

const authHeader = (auth?: Buffer): { Authorization?: string } => {
	const headers: { Authorization?: string } = {};
	if (auth != null) {
		headers.Authorization = `Bearer ${auth}`;
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
export const getDeviceByUUID = (
	uuid: string,
	auth?: Buffer,
): Bluebird<DeviceInfo> =>
	getDeviceByUUIDQuery({ uuid }, undefined, { headers: authHeader(auth) })
		.then(devices => {
			if (!_.isArray(devices) || devices.length === 0) {
				throw new Error('invalid api response');
			}
			return devices[0] as DeviceInfo;
		})
		.catch(err => {
			captureException(err, 'device-lookup-error');
			throw new APIError(err.message);
		});

const canAccessDeviceQuery = balenaApi.prepare<{ id: number }>({
	method: 'POST',
	resource: 'device',
	id: { '@': 'id' },
	url: `device(@id)/canAccess`,
});
const $canAccessDevice = (device: DeviceInfo, port: number, auth?: Buffer) =>
	canAccessDeviceQuery(
		{ id: device.id },
		{
			action: { or: ['tunnel-any', `tunnel-${port}`] },
		},
		{ headers: authHeader(auth) },
	)
		.then(
			({ d }: { d?: Array<{ id: number }> }) =>
				_.isArray(d) && d.length === 1 && d[0].id === device.id,
		)
		.catchReturn(false);
export const canAccessDevice = memoize($canAccessDevice, {
	maxAge: 5 * 1000,
	normalizer: args => `${args[0].id}-${args[1]}-${args[2] ?? 'guest'}`,
	promise: true,
});

interface VpnHost {
	id: number;
	ip_address: string;
}

export const getDeviceVpnHost = (
	uuid: string,
	auth?: Buffer,
): Bluebird<VpnHost> =>
	balenaApi
		.get({
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
		})
		.then(services => {
			if (!_.isArray(services) || services.length === 0) {
				throw new Error('invalid api response');
			}
			return services[0] as VpnHost;
		})
		.catch(err => {
			captureException(err, 'device-vpn-host-lookup-error');
			throw new APIError(`cannot find device vpn host (${err.message})`);
		});
