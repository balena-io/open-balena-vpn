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

import winston from 'winston';

import PinejsClientFetch from 'pinejs-client-fetch';
export { RequestError } from 'pinejs-client-fetch';
import { BALENA_API_INTERNAL_HOST } from './config.ts';
import { REQUEST_TIMEOUT } from './request.ts';
import type { PineClient as BalenaPineClient } from 'balena-sdk';

import packageJSON from '../../package.json' with { type: 'json' };
import { context, propagation } from '@opentelemetry/api';
export const VERSION = packageJSON.version;

class BalenaApiClient extends PinejsClientFetch {
	// Without a signal fetch only gives up after undici's 300s headers timeout followed by its 300s body
	// timeout, so a hung API would hold every in flight request (and any proxy client waiting on one)
	// for up to 10 minutes. This is called for each attempt so retries get their own timeout
	public override async _request(
		params: Parameters<PinejsClientFetch['_request']>[0],
	) {
		return await super._request({
			...params,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT),
		});
	}
}

export const balenaApi = new BalenaApiClient({
	apiPrefix: `${BALENA_API_INTERNAL_HOST}/v7/`,
}) satisfies BalenaPineClient as BalenaPineClient;

export const getPassthrough = (auth: string | undefined) => {
	const headers: Record<string, string> = {};
	// Propogate the active trace context to the api
	propagation.inject(context.active(), headers);

	if (auth != null) {
		headers.Authorization = auth;
	}
	return { headers };
};

export const getLogger = (
	service: string,
	serviceId?: number,
	workerId?: string | number,
) => {
	let label = service;
	if (serviceId != null) {
		label = `${label}-${serviceId}`;
		if (workerId != null) {
			label = `${label}.${workerId}`;
		}
	}
	const transport = new winston.transports.Console({
		format: winston.format.combine(
			winston.format.label({
				label,
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
