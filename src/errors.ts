import * as _ from 'lodash';
import * as _Raven from 'raven';

export const Raven = (() => {
	_.once(() =>
		_Raven.config(process.env.SENTRY_DSN || false, {
			captureUnhandledRejections: true,
			release: process.env.npm_package_version,
			environment: process.env.NODE_ENV,
		}).install()
	)();
	return _Raven;
})();

export const captureException = (err: Error, message?: string, options?: _Raven.CaptureOptions): string => {
	console.error(message, (err.message ? err.message : err), err.stack);
	options = options || {};
	if (message) {
		options.extra = options.extra || {};
		options.extra.message = message;
	}
	return _Raven.captureException(err, options);
};

export class HandledTunnelingError extends Error {}
