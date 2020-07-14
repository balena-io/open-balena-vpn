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

import { apiServer } from './api';
import {
	describeMetrics,
	getLogger,
	Metrics,
	ServiceInstance,
	VERSION,
} from './utils';
import { getInstanceCount, intVar } from './utils/config';

import proxyWorker from './proxy-worker';
import vpnWorker from './vpn-worker';

const masterLogger = getLogger('master');

[
	'VPN_INSTANCE_COUNT',

	'BALENA_API_HOST',
	'VPN_SERVICE_API_KEY',
	'VPN_HOST',

	'VPN_BASE_SUBNET',
	'VPN_BASE_PORT',
	'VPN_BASE_MANAGEMENT_PORT',
	'VPN_API_PORT',
	'VPN_INSTANCE_SUBNET_BITMASK',
]
	.filter((key) => process.env[key] == null)
	.forEach((key, idx, keys) => {
		masterLogger.emerg(`${key} env variable is not set.`);
		if (idx === keys.length - 1) {
			process.exit(1);
		}
	});

const VPN_INSTANCE_COUNT = getInstanceCount('VPN_INSTANCE_COUNT');
const VPN_API_PORT = intVar('VPN_API_PORT');
const VPN_VERBOSE_LOGS = process.env.DEFAULT_VERBOSE_LOGS === 'true';

const VPN_SERVICE_ADDRESS =
	process.env.VPN_SERVICE_REGISTER_INTERFACE != null
		? os.networkInterfaces()[process.env.VPN_SERVICE_REGISTER_INTERFACE]?.[0]
				?.address
		: undefined;

describeMetrics();

const main = async () => {
	if (cluster.isMaster) {
		interface WorkerMetric {
			uuid: string;
			rxBitrate: number[];
			txBitrate: number[];
		}
		let workerMetrics: { [key: string]: WorkerMetric } = {};
		let verbose = VPN_VERBOSE_LOGS;

		process.on('SIGUSR2', () => {
			masterLogger.notice('caught SIGUSR2, toggling log verbosity');
			verbose = !verbose;
			_.each(cluster.workers, (clusterWorker) => {
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

		masterLogger.notice(
			`open-balena-vpn@${VERSION} process started with pid=${process.pid}`,
		);
		masterLogger.debug('registering as service instance...');
		const serviceInstance = new ServiceInstance();
		await serviceInstance.register(VPN_SERVICE_ADDRESS);
		const serviceLogger = getLogger('master', serviceInstance.getId());
		serviceLogger.info(
			`registered as service instance with id=${serviceInstance.getId()}`,
		);

		serviceLogger.debug('spawning vpn authentication api server...');
		const api = apiServer(serviceInstance.getId());
		api.listen(VPN_API_PORT);

		serviceLogger.debug('spawning vpn metrics server...');
		const metricsServer = express();
		metricsServer
			.disable('x-powered-by')
			.get('/ping', (_req, res) => res.send('OK'))
			.get('/cluster_metrics', async (_req, res) => {
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
				try {
					const clusterMetrics = await new prometheus.AggregatorRegistry().clusterMetrics();
					res.set('Content-Type', prometheus.register.contentType);
					res.write(prometheus.register.metrics());
					res.write('\n');
					res.write(clusterMetrics);
					res.end();
					workerMetrics = {};
					metrics.reset(Metrics.SessionRxBitrate);
					metrics.reset(Metrics.SessionTxBitrate);
				} catch (err) {
					serviceLogger.warning(`error in /cluster_metrics: ${err}`);
					res.status(500).send();
				}
			})
			.listen(8080);

		serviceLogger.info(
			`spawning ${VPN_INSTANCE_COUNT} vpn worker${
				VPN_INSTANCE_COUNT > 1 ? 's' : ''
			}`,
		);
		_.times(VPN_INSTANCE_COUNT, (i) => {
			const workerId = i + 1;
			const restartWorker = (code?: number, signal?: string) => {
				if (signal != null) {
					serviceLogger.crit(`worker-${workerId} killed with signal ${signal}`);
				}
				if (code != null) {
					serviceLogger.crit(`worker-${workerId} exited with code ${code}`);
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

		return await Promise.all([api, metricsServer]);
	}

	if (cluster.isWorker) {
		const instanceId = parseInt(process.env.WORKER_ID!, 10);
		const serviceId = parseInt(process.env.SERVICE_ID!, 10);
		getLogger('worker', serviceId, instanceId).notice(
			`process started with pid=${process.pid}`,
		);
		return await Promise.all([
			vpnWorker(instanceId, serviceId),
			proxyWorker(instanceId, serviceId),
		]);
	}
};

main();
