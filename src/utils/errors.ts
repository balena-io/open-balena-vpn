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

import * as Sentry from '@sentry/node';
import { TypedError } from 'typed-error';

import { VERSION } from '.';

Sentry.init({
	dsn: process.env.SENTRY_DSN,
	debug: process.env.NODE_ENV === 'development',
	release: VERSION,
	environment: process.env.NODE_ENV,
});
export { Sentry };

export const captureException = (
	err: Error,
	fingerprint: string,
	opts?: {
		tags?: { [key: string]: string };
		req?: Sentry.PolymorphicRequest;
	},
) => {
	Sentry.withScope((scope) => {
		scope.addEventProcessor((evt) => {
			evt.fingerprint = [fingerprint];
			return evt;
		});

		if (opts != null) {
			const { tags, req } = opts;
			if (tags != null) {
				scope.setTags(tags);
			}
			if (req != null) {
				scope.addEventProcessor((evt) =>
					Sentry.addRequestDataToEvent(evt, req),
				);
			}
		}

		// avoid spamming logs if no DSN configured
		if (process.env.SENTRY_DSN) {
			Sentry.captureException(err);
		}
	});
};

export class APIError extends TypedError {}
export class BadRequestError extends TypedError {}
export class HandledTunnelingError extends TypedError {}
export class RemoteTunnellingError extends TypedError {}
export class ServiceRegistrationError extends TypedError {}
export class InvalidHostnameError extends TypedError {}
