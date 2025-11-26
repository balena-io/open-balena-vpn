/*
	Copyright (C) 2018 Balena Ltd.

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

import { metrics } from '@balena/node-metrics-gatherer';
import Bluebird from 'bluebird';
import compression from 'compression';
import express from 'express';
import memoize from 'memoizee';
import morgan from 'morgan';

import { getLogger, getPassthrough } from './utils/index.js';
import {
	BALENA_API_INTERNAL_HOST,
	DELAY_ON_AUTH_FAIL,
	TRUST_PROXY,
	VPN_AUTH_CACHE_TIMEOUT,
} from './utils/config.js';
import { captureException, Sentry } from './utils/errors.js';
import { hasDurationData, hasCommonName } from './utils/openvpn.js';
import { setTimeout } from 'timers/promises';
import { pooledRequest } from './utils/request.js';
import { Metrics } from './utils/metrics.js';
import { setConnected } from './utils/clients.js';
import { trace } from '@opentelemetry/api';
import bodyParser from 'body-parser';

// Private endpoints should use the `fromLocalHost` middleware.
const fromLocalHost: express.RequestHandler = (req, res, next) => {
	// '::ffff:127.0.0.1' is the ipv4 mapped ipv6 address and ::1 is the ipv6 loopback
	if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.ip!)) {
		return res.status(401).end();
	}

	next();
};

const checkDeviceAuth = memoize(
	async (username: string, password: string) => {
		const { statusCode } = await pooledRequest.get({
			url: `${BALENA_API_INTERNAL_HOST}/services/vpn/auth/${username}`,
			...getPassthrough(`Bearer ${password}`),
		});
		if ([200, 401, 403].includes(statusCode)) {
			return statusCode;
		}
		throw new Error(`Unexpected status code from the API: ${statusCode}`);
	},
	{
		maxAge: VPN_AUTH_CACHE_TIMEOUT,
		primitive: true,
		promise: true,
	},
);

export const apiFactory = (serviceId: number) => {
	const api = express.Router();

	const clientRefCount = new Map<string, number>();

	const logger = getLogger('vpn', serviceId);

	api.use(bodyParser.json());

	api.post('/api/v2/:worker/clients/', fromLocalHost, (req, res) => {
		if (!hasCommonName(req.body)) {
			return res.status(400).end();
		}
		// Immediately respond to minimize time in the client-connect script
		res.status(200).end();

		const workerId = parseInt(req.params.worker, 10);
		const uuid = req.body.common_name;

		const startingRefCount = clientRefCount.get(uuid) ?? 0;
		clientRefCount.set(uuid, startingRefCount + 1);

		if (startingRefCount === 0) {
			// Only increment the device as online if it wasn't previously online
			metrics.inc(Metrics.OnlineDevices);
		}
		metrics.inc(Metrics.TotalDevices);

		if (startingRefCount >= 0) {
			// Only set the device as connected if the starting ref count is >= 0, this handles the case where
			// the disconnect comes before the first connect so we go 0 -> -1 -> 0
			setConnected(uuid, serviceId, workerId, true, logger);
		}
	});

	api.post('/api/v1/auth/', fromLocalHost, async function (req, res) {
		if (req.body?.username == null) {
			logger.info('AUTH FAIL: UUID not specified.');
			return res.status(400).end();
		}

		if (req.body?.password == null) {
			logger.info('AUTH FAIL: API Key not specified.');
			return res.status(400).end();
		}

		try {
			const statusCode = await checkDeviceAuth(
				req.body.username,
				req.body.password,
			);
			if (statusCode === 200) {
				return res.send('OK');
			} else {
				logger.info(
					`AUTH FAIL: API Authentication failed for ${req.body.username}`,
				);
				metrics.inc(Metrics.AuthFailures);
				metrics.inc(Metrics.AuthFailuresByUuid, undefined, {
					device_uuid: req.body.common_name,
				});
				await setTimeout(DELAY_ON_AUTH_FAIL);
				return res.status(401).end();
			}
		} catch (err) {
			captureException(err, 'api-auth-error');
			res.status(401).end();
		}
	});

	api.delete('/api/v2/:worker/clients/', fromLocalHost, (req, res) => {
		if (!hasCommonName(req.body)) {
			return res.status(400).end();
		}

		if (hasDurationData(req.body)) {
			metrics.histogram(Metrics.SessionDuration, req.body.time_duration);
		}

		const workerId = parseInt(req.params.worker, 10);
		const uuid = req.body.common_name;

		const startingRefCount = clientRefCount.get(uuid) ?? 0;
		clientRefCount.set(uuid, startingRefCount - 1);

		if (startingRefCount !== 1) {
			logger.warning(
				`dropping oos disconnect event for uuid=${uuid} worker=${workerId} refcount=${startingRefCount - 1}`,
			);
			return res.status(400).end();
		}
		res.status(200).end();

		metrics.dec(Metrics.OnlineDevices);

		setConnected(uuid, serviceId, workerId, false, logger);
	});

	return api;
};

interface ExpressAsync extends express.Express {
	listenAsync(port: number): Promise<ReturnType<express.Express['listen']>>;
}

export const apiServer = (serviceId: number) => {
	const app = Bluebird.promisifyAll(express()) as any as ExpressAsync;
	app.set('trust proxy', TRUST_PROXY);
	app.disable('x-powered-by');
	app.get('/ping', (_req, res) => res.send('OK'));
	app.use(
		morgan((tokens, req, res) => {
			const ip = tokens['remote-addr'](req, res);
			const traceId = trace.getActiveSpan()?.spanContext().traceId ?? '-';
			const url = tokens.url(req, res);
			const statusCode = tokens.status(req, res) ?? '-';
			const responseTime = tokens['response-time'](req, res) ?? '-';

			return `${ip} ${traceId} ${req.method} ${url} ${statusCode} ${responseTime}ms`;
		}),
	);
	app.use(compression());
	app.use(apiFactory(serviceId));
	Sentry.setupExpressErrorHandler(app);
	return app;
};
