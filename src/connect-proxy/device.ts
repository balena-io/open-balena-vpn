import * as Promise from 'bluebird';
import * as _ from 'lodash';

import * as utils from '../utils';

[
	'VPN_SERVICE_API_KEY',
	'PROXY_SERVICE_API_KEY',
]
	.filter((key) => process.env[key] == null)
	.forEach((key, idx, keys) => {
		console.error(`${key} env variable is not set.`);
		if (idx === (keys.length - 1)) {
			process.exit(1);
		}
	});

const DEVICE_WEB_PORTS = [ 80, 8080 ];
const DEVICE_SSH_PORT = 22222;
const API_USERNAME = 'resin_api';
const API_KEY = process.env.VPN_SERVICE_API_KEY!;
const PROXY_USERNAME = 'resin_proxy';
const PROXY_KEY = process.env.PROXY_SERVICE_API_KEY!;

export interface DeviceInfo {
	id: string;
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
			apikey: apiKey,
		},
	})
	.then((devices) => {
		if (!_.isArray(devices)) {
			throw new Error('Invalid device lookup response');
		}
		return devices[0] as DeviceInfo;
	});

// Given the device model, a port and credentials (an object with username and password)
// return true if the client is allowed to connect that port of the device.
export const isAccessible = (device: DeviceInfo, port: string, auth?: {username?: string; password?: string}): boolean => {
	const isResinApi = auth != null && auth.username === API_USERNAME && auth.password === API_KEY;
	const isResinSSHProxy = auth != null && auth.username === PROXY_USERNAME && auth.password === PROXY_KEY && parseInt(port, 10) === DEVICE_SSH_PORT;
	const isWebPort = _.includes(DEVICE_WEB_PORTS, parseInt(port, 10));
	return isResinApi || isResinSSHProxy || (device.is_web_accessible && isWebPort);
};
