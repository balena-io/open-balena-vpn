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

import * as cluster from 'cluster';
import * as _ from 'lodash';
import * as os from 'os';

import { logger, VERSION } from '../utils';

import worker from './worker';

['VPN_CONNECT_INSTANCE_COUNT', 'VPN_CONNECT_PROXY_PORT']
	.filter(key => process.env[key] == null)
	.forEach((key, idx, keys) => {
		logger.emerg(`${key} env variable is not set.`);
		if (idx === keys.length - 1) {
			process.exitCode = 1;
		}
	});

const VPN_CONNECT_INSTANCE_COUNT =
	parseInt(process.env.VPN_CONNECT_INSTANCE_COUNT!, 10) || os.cpus().length;
const VPN_CONNECT_PROXY_PORT = process.env.VPN_CONNECT_PROXY_PORT!;

if (cluster.isMaster) {
	logger.info(
		`connect-proxy@${VERSION} master process started with pid ${process.pid}`,
	);
	if (VPN_CONNECT_INSTANCE_COUNT > 1) {
		logger.info(
			`spawning ${VPN_CONNECT_INSTANCE_COUNT} proxy worker processes`,
		);
		// spawn worker processes
		_.times(VPN_CONNECT_INSTANCE_COUNT, cluster.fork);
		cluster.on('exit', (childWorker: cluster.Worker, code: number) => {
			logger.crit(
				`proxy worker ${childWorker.process.pid} exited with code ${code}`,
			);
			cluster.fork();
		});
	}
}

if (cluster.isWorker || VPN_CONNECT_INSTANCE_COUNT === 1) {
	worker(VPN_CONNECT_PROXY_PORT);
}
