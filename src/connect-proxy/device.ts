/*
	Copyright (C) 2017 Resin.io Ltd.

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

import * as Promise from 'bluebird';
import * as _ from 'lodash';

import * as utils from '../utils';

export interface DeviceInfo {
	id: number;
	uuid: string;
	is_web_accessible: boolean;
	is_connected_to_vpn: boolean;
}

export const getDeviceByUUID = (uuid: string, apiKey: string): Promise<DeviceInfo> =>
	utils.resinApi.get({
		resource: 'device',
		options: {
			$select: [ 'id', 'uuid', 'is_web_accessible', 'is_connected_to_vpn' ],
			$filter: {
				uuid,
			},
		},
		passthrough: { headers: { Authorization: `Bearer ${apiKey}` } },
	})
	.then((devices) => {
		if (!_.isArray(devices)) {
			throw new Error('Invalid device lookup response');
		}
		return devices[0] as DeviceInfo;
	});

export const canAccessDevice = (device: DeviceInfo, port: number, auth?: {username?: string, password?: string}): Promise<boolean> => {
	const headers: {Authorization?: string} = {};
	if (auth != null && auth.password != null) {
		headers.Authorization = `Bearer ${auth.password}`;
	}
	return utils.resinApi.post({
		resource: 'device',
		id: device.id,
		passthrough: { headers },
		body: {
			action: `tunnel-${port}`,
		},
		url: `device(${device.id})/canAccess`,
	})
	.then(({ d }: { d?: Array<{ id: number }> }) =>
		_.isArray(d) && d.length === 1 && d[ 0 ].id === device.id);
};
