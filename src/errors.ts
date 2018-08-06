import * as _Raven from 'raven';
import { TypedError } from 'typed-error';

import { VERSION } from './utils';

export const Raven = _Raven;

Raven.config(process.env.SENTRY_DSN || false, {
	captureUnhandledRejections: true,
	release: VERSION,
	environment: process.env.NODE_ENV,
}).install();

export const captureException = (err: Error, message?: string, options?: _Raven.CaptureOptions): string => {
	console.error(message, (err.message ? err.message : err), err.stack);
	options = options || {};
	if (message) {
		options.extra = options.extra || {};
		options.extra.message = message;
	}
	return Raven.captureException(err, options);
};

export class HandledTunnelingError extends TypedError {}
export class ServiceRegistrationError extends TypedError {}
