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

import { PinejsClientCoreFactory, PinejsClientRequest } from 'pinejs-client-request';
export { PinejsClientCoreFactory } from 'pinejs-client-request';
import * as pkg from 'pjson';
import * as winston from 'winston';

export type AnyObject = PinejsClientCoreFactory.AnyObject;

export const resinApi = new PinejsClientRequest(`https://${process.env.BALENA_API_HOST}/v4/`);
export const apiKey = process.env.VPN_SERVICE_API_KEY;
export const VERSION = pkg.version;

winston.add(new winston.transports.Console({format: winston.format.simple()}));

export { Netmask } from './netmask';
export { request } from './request';
export { winston as logger };
