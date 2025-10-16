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

import './init.js';

import { metrics } from '@balena/node-metrics-gatherer';
import cluster from 'cluster';
import express from 'express';
import _ from 'lodash';
import prometheus from 'prom-client';
import pTimeout from 'p-timeout';

import { apiServer } from './api.js';
import { getLogger, VERSION } from './utils/index.js';
import {
	DEFAULT_SIGTERM_TIMEOUT,
	METRICS_TIMEOUT,
	TRUST_PROXY,
	VPN_API_PORT,
	VPN_INSTANCE_COUNT,
	VPN_SERVICE_ADDRESS,
	VPN_VERBOSE_LOGS,
} from './utils/config.js';

import proxyWorker from './proxy-worker.js';
import vpnWorker from './vpn-worker.js';
import { intVar } from '@balena/env-parsing';
import { describeMetrics, Metrics } from './utils/metrics.js';
import { service } from './utils/service.js';

const masterLogger = getLogger('master');

describeMetrics();

export interface BitrateMessage {
	type: 'bitrate';
	data: {
		uuid: string;
		rxBitrate: number;
		txBitrate: number;
	};
}

if (cluster.isPrimary) {
	interface WorkerMetric {
		rxBitrate: Array<BitrateMessage['data']['rxBitrate']>;
		txBitrate: Array<BitrateMessage['data']['txBitrate']>;
	}
	const workerMetrics = new Map<string, WorkerMetric>();

	let verbose = VPN_VERBOSE_LOGS;

	type WorkerState = {
		instanceId: number;
		finished: boolean;
	};
	const workerStates: { [instanceId: number]: WorkerState } = {};

	process.on('SIGUSR2', () => {
		masterLogger.notice('caught SIGUSR2, toggling log verbosity');
		verbose = !verbose;
		_.each(cluster.workers, (clusterWorker) => {
			if (clusterWorker != null) {
				clusterWorker.send('toggleVerbosity');
			}
		});
	});

	process.on('SIGTERM', () => {
		masterLogger.notice('received SIGTERM');
		_.each(cluster.workers, (clusterWorker) => {
			clusterWorker?.send('prepareShutdown');
		});
		masterLogger.notice(
			`waiting ${DEFAULT_SIGTERM_TIMEOUT}ms for workers to finish`,
		);
	});

	cluster.on('message', (_worker, msg: BitrateMessage) => {
		const { data, type } = msg;
		if (type === 'bitrate') {
			const workerMetric = workerMetrics.get(data.uuid) ?? {
				rxBitrate: [],
				txBitrate: [],
			};
			workerMetrics.set(
				data.uuid,
				_.mergeWith(workerMetric, data, (obj, src) => {
					if (Array.isArray(obj)) {
						return obj.concat([src]);
					}
				}),
			);
		} else {
			return;
		}
	});

	cluster.on('message', (_worker, msg: { type: string; data: WorkerState }) => {
		const { data, type } = msg;

		// worker finished connection draining
		if (type === 'drain') {
			try {
				workerStates[data.instanceId] = data;
				const drainCount = Object.keys(workerStates).length;
				masterLogger.notice(
					`total: ${VPN_INSTANCE_COUNT} drained: ${drainCount}`,
				);
				for (const key in workerStates) {
					if (key != null) {
						const value: WorkerState = workerStates[key];
						const workerState = value.finished;
						masterLogger.notice(`instanceId:${key} finished:${workerState}`);
					}
				}
				if (drainCount >= VPN_INSTANCE_COUNT) {
					masterLogger.notice(`all ${drainCount} worker(s) drained`);
					process.exit(0);
				}
			} catch (err) {
				masterLogger.warning(`${err} handling message from worker`);
			}
		} else {
			return;
		}
	});

	masterLogger.notice(
		`open-balena-vpn@${VERSION} process started with pid=${process.pid}`,
	);
	masterLogger.debug('registering as service instance...');
	service
		.wrap({ ipAddress: VPN_SERVICE_ADDRESS }, async (serviceInstance) => {
			const serviceLogger = getLogger('master', serviceInstance.getId());
			serviceLogger.info(
				`registered as service instance with id=${serviceInstance.getId()} ipAddress=${VPN_SERVICE_ADDRESS}`,
			);

			serviceLogger.info('spawning vpn authentication api server...');
			const api = apiServer(serviceInstance.getId());
			await api.listenAsync(VPN_API_PORT).then(() => {
				serviceLogger.info(
					`spawning ${VPN_INSTANCE_COUNT} worker${
						VPN_INSTANCE_COUNT > 1 ? 's' : ''
					}`,
				);
				_.times(VPN_INSTANCE_COUNT, (i) => {
					const workerId = i + 1;
					const restartWorker = (code?: number, signal?: string) => {
						if (signal != null) {
							serviceLogger.crit(
								`worker-${workerId} killed with signal ${signal}`,
							);
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

				const aggregatorRegistry = new prometheus.AggregatorRegistry();

				const app = express();
				app.set('trust proxy', TRUST_PROXY);
				app.disable('x-powered-by');
				app.get('/ping', (_req, res) => res.send('OK'));

				// Avoid stacking up fetching cluster metrics fetch attempts by making sure we
				// only ever have one in progress at a time.
				let inProgessClusterMetrics: undefined | Promise<string>;
				const getClusterMetrics = async () => {
					inProgessClusterMetrics ??= aggregatorRegistry.clusterMetrics();
					try {
						return await inProgessClusterMetrics;
					} finally {
						inProgessClusterMetrics = undefined;
					}
				};
				app
					.get('/cluster_metrics', async (_req, res) => {
						for (const clientMetrics of workerMetrics.values()) {
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
							const [promMetrics, clusterMetrics] = await Promise.all([
								pTimeout(prometheus.register.metrics(), {
									milliseconds: METRICS_TIMEOUT,
								}),
								pTimeout(getClusterMetrics(), {
									milliseconds: METRICS_TIMEOUT,
								}),
							]);
							res.set('Content-Type', prometheus.register.contentType);
							res.write(promMetrics);
							res.write('\n');
							res.write(clusterMetrics);
							res.end();
							workerMetrics.clear();
							metrics.reset(Metrics.SessionRxBitrate);
							metrics.reset(Metrics.SessionTxBitrate);
						} catch (err) {
							serviceLogger.warning(`error in /cluster_metrics: ${err}`);
							res.status(500).send();
						}
					})
					.listen(8080);

				return [app, metrics];
			});
		})
		.catch((err) => {
			console.error('Error starting master:', err);
			process.exit(1);
		});
}

if (cluster.isWorker) {
	// Ensure the prom-client worker listener is registered by instantiating the class
	// tslint:disable-next-line:no-unused-expression-chai
	new prometheus.AggregatorRegistry();

	const instanceId = intVar('WORKER_ID');
	const serviceId = intVar('SERVICE_ID');
	getLogger('worker', serviceId, instanceId).notice(
		`process started with pid=${process.pid}`,
	);
	vpnWorker(instanceId, serviceId)
		.then(() => proxyWorker(instanceId, serviceId))
		.catch((err) => {
			console.error('Error starting worker:', err);
			process.exit(1);
		});
}
