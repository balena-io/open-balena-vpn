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

import * as winston from 'winston';

import { PinejsClientRequest } from 'pinejs-client-request';
export { PinejsClientCoreFactory } from 'pinejs-client-request';

export { version as VERSION } from '../../package.json';

export { captureException } from './errors';

export const balenaApi = new PinejsClientRequest(
	`https://${process.env.BALENA_API_HOST}/v5/`,
);
export const apiKey = process.env.VPN_SERVICE_API_KEY;

export const getLogger = (
	service: string,
	workerId?: string | number,
	serviceId?: number,
) => {
	let workerLabel = 'master';
	if (workerId != null && serviceId != null) {
		workerLabel = `${serviceId}.${workerId}`;
	}
	const transport = new winston.transports.Console({
		format: winston.format.combine(
			winston.format.label({
				label: `${service}-${workerLabel}`,
				message: true,
			}),
			winston.format.simple(),
		),
		level: 'debug',
	});
	return winston.createLogger({
		transports: [transport],
		exceptionHandlers: [transport],
		exitOnError: false,
		levels: winston.config.syslog.levels,
	});
};

import * as clients from './clients';
export { clients };
import * as device from './device';
export { device };
import * as errors from './errors';
export { errors };
export { HAProxy } from './haproxy';
export { describeMetrics, Metrics } from './metrics';
export { Netmask } from './netmask';
export { VpnManager } from './openvpn';
export { pooledRequest } from './request';
export { service } from './service';
