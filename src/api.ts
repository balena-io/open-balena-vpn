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
import * as Promise from 'bluebird';
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
import { Sentry } from './utils/errors';
import { hasDurationData, isTrusted } from './utils/openvpn';

const BALENA_API_HOST = process.env.BALENA_API_HOST!;

// Private endpoints should use the `fromLocalHost` middleware.
const fromLocalHost: express.RequestHandler = (req, res, next) => {
	// '::ffff:127.0.0.1' is the ipv4 mapped ipv6 address and ::1 is the ipv6 loopback
	if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.ip)) {
		return res.sendStatus(401);
	}

	next();
};

export const apiFactory = (serviceId: number) => {
	const api = express.Router();

	const workerMap: _.Dictionary<string> = {};

	const logger = getLogger('vpn', serviceId);

	const logStateUpdate = (state: clients.DeviceState) => {
		let stateMsg = `uuid=${state.common_name} worker_id=${state.worker_id} connected=${state.connected}`;
		if (state.virtual_address != null) {
			stateMsg = `${stateMsg} virtual_address=${state.virtual_address}`;
		}
		logger.debug(`successfully updated state for device: ${stateMsg}`);
	};

	api.use(express.json());

	api.post('/api/v2/:worker/clients/', fromLocalHost, (req, res) => {
		if (!isTrusted(req.body)) {
			return res.sendStatus(400);
		}
		metrics.inc(Metrics.OnlineDevices);
		metrics.inc(Metrics.TotalDevices);

		if (
			workerMap[req.body.common_name] != null &&
			workerMap[req.body.common_name] !== req.params.worker
		) {
			metrics.dec(Metrics.OnlineDevices);
		}

		workerMap[req.body.common_name] = req.params.worker;
		clients
			.connected(serviceId, req.params.worker, req.body)
			.then(logStateUpdate);
		res.send('OK');
	});

	api.post('/api/v1/auth/', fromLocalHost, async function (req, res) {
		if (req.body.username == null) {
			logger.info('AUTH FAIL: UUID not specified.');
			return res.sendStatus(400);
		}

		if (req.body.password == null) {
			logger.info('AUTH FAIL: API Key not specified.');
			return res.sendStatus(400);
		}

		try {
			const response = await pooledRequest.get({
				url: `https://${BALENA_API_HOST}/services/vpn/auth/${req.body.username}`,
				timeout: 30000,
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
				return res.sendStatus(401);
			}
		} catch (err) {
			captureException(err, 'api-auth-error', { req });
			res.sendStatus(401);
		}
	});

	api.delete('/api/v2/:worker/clients/', fromLocalHost, (req, res) => {
		if (!isTrusted(req.body)) {
			return res.sendStatus(400);
		}

		if (hasDurationData(req.body)) {
			metrics.histogram(Metrics.SessionDuration, req.body.time_duration);
		}

		if (workerMap[req.body.common_name] !== req.params.worker) {
			logger.warning(
				`dropping oos disconnect event for uuid=${
					req.body.common_name
				} worker=${req.params.worker} (expected=${
					workerMap[req.body.common_name]
				})`,
			);
			captureException(
				new Error('Out of Sync OpenVPN Client Event Received'),
				'openvpn-oos-event',
				{ tags: { uuid: req.body.common_name }, req },
			);
			return res.sendStatus(400);
		}
		delete workerMap[req.body.common_name];

		metrics.dec(Metrics.OnlineDevices);

		clients
			.disconnected(serviceId, req.params.worker, req.body)
			.then(logStateUpdate);
		res.send('OK');
	});

	return api;
};

interface ExpressAsync extends express.Express {
	listenAsync(port: number): Promise<ReturnType<express.Express['listen']>>;
}

export const apiServer = (serviceId: number) => {
	const app = Promise.promisifyAll(express()) as ExpressAsync;
	app.disable('x-powered-by');
	app.get('/ping', (_req, res) => res.send('OK'));
	app.use(morgan('combined'));
	app.use(compression());
	app.use(apiFactory(serviceId));
	app.use(Sentry.Handlers.errorHandler());
	return app;
};
