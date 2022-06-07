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
import * as Bluebird from 'bluebird';
import * as compression from 'compression';
import * as express from 'express';
import * as morgan from 'morgan';

import {
	captureException,
	clients,
	getLogger,
	Metrics,
	pooledRequest,
} from './utils';
import { BALENA_API_HOST, TRUST_PROXY } from './utils/config';
import { Sentry } from './utils/errors';
import { hasDurationData, isTrusted } from './utils/openvpn';

// Private endpoints should use the `fromLocalHost` middleware.
const fromLocalHost: express.RequestHandler = (req, res, next) => {
	// '::ffff:127.0.0.1' is the ipv4 mapped ipv6 address and ::1 is the ipv6 loopback
	if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.ip)) {
		return res.status(401).end();
	}

	next();
};

export const apiFactory = (serviceId: number) => {
	const api = express.Router();

	const workerMap: _.Dictionary<string> = {};

	const logger = getLogger('vpn', serviceId);

	api.use(express.json());

	api.post('/api/v2/:worker/clients/', fromLocalHost, (req, res) => {
		if (!isTrusted(req.body)) {
			return res.status(400).end();
		}
		// Immediately respond to minimize time in the client-connect script
		res.status(200).end();

		metrics.inc(Metrics.OnlineDevices);
		metrics.inc(Metrics.TotalDevices);

		const workerId = req.params.worker;
		const uuid = req.body.common_name;
		if (workerMap[uuid] != null && workerMap[uuid] !== req.params.worker) {
			metrics.dec(Metrics.OnlineDevices);
		}

		workerMap[uuid] = workerId;
		clients.setConnected(uuid, serviceId, true, logger);
	});

	api.post('/api/v1/auth/', fromLocalHost, async function (req, res) {
		if (req.body.username == null) {
			logger.info('AUTH FAIL: UUID not specified.');
			return res.status(400).end();
		}

		if (req.body.password == null) {
			logger.info('AUTH FAIL: API Key not specified.');
			return res.status(400).end();
		}

		try {
			const response = await pooledRequest.get({
				url: `https://${BALENA_API_HOST}/services/vpn/auth/${req.body.username}`,
				headers: { Authorization: `Bearer ${req.body.password}` },
			});
			if (response.statusCode === 200) {
				return res.send('OK');
			} else {
				logger.info(
					`AUTH FAIL: API Authentication failed for ${req.body.username}`,
				);
				metrics.inc(Metrics.AuthFailures);
				metrics.inc(Metrics.AuthFailuresByUuid, undefined, {
					device_uuid: req.body.common_name,
				});
				return res.status(401).end();
			}
		} catch (err) {
			captureException(err, 'api-auth-error', { req });
			res.status(401).end();
		}
	});

	api.delete('/api/v2/:worker/clients/', fromLocalHost, (req, res) => {
		if (!isTrusted(req.body)) {
			return res.status(400).end();
		}

		if (hasDurationData(req.body)) {
			metrics.histogram(Metrics.SessionDuration, req.body.time_duration);
		}

		const workerId = req.params.worker;
		const uuid = req.body.common_name;

		if (workerMap[uuid] !== workerId) {
			logger.warning(
				`dropping oos disconnect event for uuid=${uuid} worker=${workerId} (expected=${workerMap[uuid]})`,
			);
			captureException(
				new Error('Out of Sync OpenVPN Client Event Received'),
				'openvpn-oos-event',
				{ tags: { uuid }, req },
			);
			return res.status(400).end();
		}
		res.status(200).end();

		delete workerMap[uuid];

		metrics.dec(Metrics.OnlineDevices);

		clients.setConnected(uuid, serviceId, false, logger);
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
	app.use(morgan('combined'));
	app.use(compression());
	app.use(apiFactory(serviceId));
	app.use(Sentry.Handlers.errorHandler());
	return app;
};
