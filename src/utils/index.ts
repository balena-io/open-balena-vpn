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

import { metrics } from '@balena/node-metrics-gatherer';
import * as cluster from 'cluster';
import * as express from 'express';
import * as _ from 'lodash';
import * as winston from 'winston';

import { PinejsClientRequest } from 'pinejs-client-request';
export { PinejsClientCoreFactory } from 'pinejs-client-request';

export { version as VERSION } from '../../package.json';

export { captureException } from './errors';

export const balenaApi = new PinejsClientRequest(
	`https://${process.env.BALENA_API_HOST}/v5/`,
);
export const apiKey = process.env.VPN_SERVICE_API_KEY;

export const getLogger = (service: string, workerId?: string | number) => {
	let workerLabel = 'master';
	if (workerId != null) {
		workerLabel = `${workerId}`;
	}
	const transport = new winston.transports.Console({
		format: winston.format.combine(
			winston.format.label({
				label: `${service}-${workerLabel}`,
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

export const metricsServer = (handler?: express.RequestHandler) => {
	const app = express();
	app.disable('x-powered-by');
	app.get('/ping', (_req, res) => res.send('OK'));
	app.get('/cluster_metrics', handler || metrics.aggregateRequestHandler());
	return app;
};

export const spawnChildren = (n: number, logger: winston.Logger) => {
	logger.info(`spawning ${n} worker${n > 1 ? 's' : ''}`);
	_.times(n, i => {
		const workerId = i + 1;
		const restartWorker = (code?: number, signal?: string) => {
			if (signal != null) {
				logger.crit(`worker-${workerId} killed with signal ${signal}`);
			}
			if (code != null) {
				logger.crit(`worker-${workerId} exited with code ${code}`);
			}
			const env = {
				...process.env,
				WORKER_ID: workerId,
			};
			cluster.fork(env).on('exit', restartWorker);
		};
		restartWorker();
	});
};
