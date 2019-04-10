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

const consoleTransport = new winston.transports.Console({
	format: winston.format.combine(
		winston.format.colorize(),
		winston.format.simple(),
	),
	level: 'debug',
});
export const logger = winston.createLogger({
	transports: [consoleTransport],
	exceptionHandlers: [consoleTransport],
	exitOnError: false,
	levels: winston.config.syslog.levels,
});
