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

const isDeviceConnectedToVpnQuery = balenaApi.prepare(
	{
		resource: 'device',
		id: { '@': 'id' },
		options: {
			$select: ['id'],
			$filter: {
				$: 'is_connected_to_vpn',
			},
		},
	},
	{ id: ['number'] },
);
export const isDeviceConnectedToVpn = async (
	id: number,
	auth?: Buffer,
): Promise<boolean> => {
	try {
		const device = await isDeviceConnectedToVpnQuery(
			{ id },
			undefined,
			getPassthrough(authHeader(auth)),
		);
		if (device == null) {
			return false;
		}
		return true;
	} catch (err) {
		captureException(err, 'device-lookup-error');
		throw new APIError(err.message);
	}
};

const $canAccessDevice = async (uuid: string, port: number, auth?: Buffer) => {
	try {
		const { d } = (await balenaApi.request({
			method: 'POST',
			url: `device(uuid=@uuid)/canAccess?@uuid='${uuid}'`,
			body: {
				action: { or: ['tunnel-any', `tunnel-${port}`] },
			},
			passthrough: getPassthrough(authHeader(auth)),
		})) as { d?: Array<{ id: number }> };
		if (!Array.isArray(d) || d.length !== 1) {
			return false;
		}
		return d[0].id;
	} catch {
		return false;
	}
};
export const canAccessDevice = memoize($canAccessDevice, {
	maxAge: 5 * 1000,
	normalizer: (args) => `${args[0]}-${args[1]}-${args[2] ?? 'guest'}`,
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
							$expr: {
								d: { uuid },
								$: ['d', 'is_connected_to_vpn'],
							},
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
