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
import * as cluster from 'cluster';
import * as express from 'express';
import * as _ from 'lodash';
import * as os from 'os';
import * as prometheus from 'prom-client';

import { describeMetrics, getLogger, Metrics, service, VERSION } from './utils';

import proxyWorker from './proxy-worker';
import vpnWorker from './vpn-worker';

const logger = getLogger('vpn');

[
	'VPN_INSTANCE_COUNT',

	'BALENA_API_HOST',
	'VPN_SERVICE_API_KEY',
	'VPN_HOST',

	'VPN_BASE_SUBNET',
	'VPN_BASE_PORT',
	'VPN_BASE_MANAGEMENT_PORT',
	'VPN_API_BASE_PORT',
	'VPN_INSTANCE_SUBNET_BITMASK',
]
	.filter(key => process.env[key] == null)
	.forEach((key, idx, keys) => {
		logger.emerg(`${key} env variable is not set.`);
		if (idx === keys.length - 1) {
			process.exit(1);
		}
	});

const VPN_INSTANCE_COUNT =
	parseInt(process.env.VPN_INSTANCE_COUNT!, 10) || os.cpus().length;

const VPN_VERBOSE_LOGS = process.env.DEFAULT_VERBOSE_LOGS === 'true';

describeMetrics();

if (cluster.isMaster) {
	interface WorkerMetric {
		uuid: string;
		rxBitrate: number[];
		txBitrate: number[];
	}
	let workerMetrics: { [key: string]: WorkerMetric } = {};
	let verbose = VPN_VERBOSE_LOGS;

	process.on('SIGUSR2', () => {
		logger.notice('caught SIGUSR2, toggling log verbosity');
		verbose = !verbose;
		_.each(cluster.workers, clusterWorker => {
			if (clusterWorker != null) {
				clusterWorker.send('toggleVerbosity');
			}
		});
	});

	cluster.on(
		'message',
		(_worker, msg: { type: string; data: WorkerMetric }) => {
			const { data, type } = msg;
			if (type !== 'bitrate') {
				return;
			}
			workerMetrics[data.uuid] = _.mergeWith(
				workerMetrics[data.uuid] || { rxBitrate: [], txBitrate: [] },
				data,
				(obj, src) => {
					if (_.isArray(obj)) {
						return obj.concat([src]);
					}
				},
			);
		},
	);

	logger.notice(
		`open-balena-vpn@${VERSION} process started with pid=${process.pid}`,
	);
	logger.debug('registering as service instance...');
	service.wrap(serviceInstance => {
		logger.info(
			`registered as service instance with id=${serviceInstance.getId()}`,
		);
		logger.info(
			`spawning ${VPN_INSTANCE_COUNT} worker${
				VPN_INSTANCE_COUNT > 1 ? 's' : ''
			}`,
		);
		_.times(VPN_INSTANCE_COUNT, i => {
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
					SERVICE_ID: serviceInstance.getId(),
					VPN_VERBOSE_LOGS: verbose,
				};
				cluster.fork(env).on('exit', restartWorker);
			};
			restartWorker();
		});

		const app = express();
		app.disable('x-powered-by');
		app.get('/ping', (_req, res) => res.send('OK'));
		app
			.get('/cluster_metrics', (_req, res) => {
				for (const clientMetrics of Object.values(workerMetrics)) {
					metrics.histogram(
						Metrics.SessionRxBitrate,
						_.mean(clientMetrics.rxBitrate),
					);
					metrics.histogram(
						Metrics.SessionTxBitrate,
						_.mean(clientMetrics.txBitrate),
					);
				}
				return new prometheus.AggregatorRegistry()
					.clusterMetrics()
					.then((clusterMetrics: string) => {
						res.set('Content-Type', prometheus.register.contentType);
						res.write(prometheus.register.metrics());
						res.write('\n');
						res.write(clusterMetrics);
						res.end();
						workerMetrics = {};
						metrics.reset(Metrics.SessionRxBitrate);
						metrics.reset(Metrics.SessionTxBitrate);
					})
					.catch((err: Error) => {
						logger.warning(`error in /cluster_metrics: ${err}`);
						res.status(500).send();
					});
			})
			.listen(8080);
	});
}

if (cluster.isWorker) {
	const instanceId = parseInt(process.env.WORKER_ID!, 10);
	const serviceId = parseInt(process.env.SERVICE_ID!, 10);
	getLogger('worker', instanceId, serviceId).notice(
		`process started with pid=${process.pid}`,
	);
	vpnWorker(instanceId, serviceId).then(() =>
		proxyWorker(instanceId, serviceId),
	);
}
