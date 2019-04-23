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
import * as os from 'os';

import { getLogger, metricsServer, spawnChildren, VERSION } from '../utils';

import worker from './worker';

const logger = getLogger('proxy');

['VPN_CONNECT_INSTANCE_COUNT', 'VPN_CONNECT_PROXY_PORT', 'VPN_SERVICE_API_KEY']
	.filter(key => process.env[key] == null)
	.forEach((key, idx, keys) => {
		logger.emerg(`${key} env variable is not set.`);
		if (idx === keys.length - 1) {
			process.exit(1);
		}
	});

const VPN_CONNECT_INSTANCE_COUNT =
	parseInt(process.env.VPN_CONNECT_INSTANCE_COUNT!, 10) || os.cpus().length;
const VPN_CONNECT_PROXY_PORT = process.env.VPN_CONNECT_PROXY_PORT!;

if (cluster.isMaster) {
	logger.info(
		`open-balena-proxy@${VERSION} master process started with pid=${
			process.pid
		}`,
	);
	spawnChildren(VPN_CONNECT_INSTANCE_COUNT, logger);
	metricsServer().listen(8888);
}

if (cluster.isWorker) {
	worker(VPN_CONNECT_PROXY_PORT);
}
