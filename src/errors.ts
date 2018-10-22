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

import * as _Raven from 'raven';
import { TypedError } from 'typed-error';

import { logger, VERSION } from './utils';

export const Raven = _Raven;

Raven.config(process.env.SENTRY_DSN || false, {
	captureUnhandledRejections: true,
	release: VERSION,
	environment: process.env.NODE_ENV,
}).install();

export const captureException = (err: Error, message?: string, options?: _Raven.CaptureOptions): string => {
	logger.error(message || '', (err.message ? err.message : err), err.stack);
	options = options || {};
	if (message) {
		options.extra = options.extra || {};
		options.extra.message = message;
	}
	return Raven.captureException(err, options);
};

export class HandledTunnelingError extends TypedError {}
export class ServiceRegistrationError extends TypedError {}
