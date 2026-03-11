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

import cluster from 'cluster';
import prometheus from 'prom-client';

import { getLogger } from './utils/index.js';

import proxyWorker from './proxy-worker.js';
import vpnWorker from './vpn-worker.js';
import { intVar } from '@balena/env-parsing';
import { describeWorkerMetrics } from './utils/metrics.js';

if (!cluster.isWorker) {
	throw new Error('init-worker should only be imported by a worker process');
}

describeWorkerMetrics();

// Ensure the prom-client worker listener is registered by instantiating the class
// tslint:disable-next-line:no-unused-expression-chai
new prometheus.AggregatorRegistry();

const instanceId = intVar('WORKER_ID');
const serviceId = intVar('SERVICE_ID');
getLogger('worker', serviceId, instanceId).notice(
	`process started with pid=${process.pid}`,
);
try {
	await vpnWorker(instanceId, serviceId);
	proxyWorker(instanceId, serviceId);
} catch (err) {
	console.error('Error starting worker:', err);
	process.exit(1);
}
