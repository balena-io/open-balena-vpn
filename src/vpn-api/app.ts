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

import * as cluster from 'cluster';
import * as _ from 'lodash';
import * as os from 'os';

import { logger, VERSION } from '../utils';

import { service } from './utils';
import worker from './worker';

['VPN_INSTANCE_COUNT']
	.filter(key => process.env[key] == null)
	.forEach((key, idx, keys) => {
		logger.error(`${key} env variable is not set.`);
		if (idx === keys.length - 1) {
			process.exit(1);
		}
	});

const VPN_INSTANCE_COUNT =
	parseInt(process.env.VPN_INSTANCE_COUNT!, 10) || os.cpus().length;

if (cluster.isMaster) {
	logger.info(
		`open-balena-vpn@${VERSION} master process started with pid ${process.pid}`,
	);
	if (VPN_INSTANCE_COUNT > 1) {
		logger.info(`spawning ${VPN_INSTANCE_COUNT} workers`);
		_.times(VPN_INSTANCE_COUNT, i => {
			const instanceId = i + 1;
			const restartWorker = (code?: number, signal?: string) => {
				if (signal != null) {
					logger.error(
						`open-balena-vpn worker-${instanceId} killed with signal ${signal}`,
					);
				}
				if (code != null) {
					logger.error(
						`open-balena-vpn worker-${instanceId} exited with code ${code}`,
					);
				}
				cluster.fork({ VPN_INSTANCE_ID: instanceId }).on('exit', restartWorker);
			};
			restartWorker();
		});
	}
}

if (cluster.isWorker || VPN_INSTANCE_COUNT === 1) {
	const instanceId = parseInt(process.env.VPN_INSTANCE_ID || '1', 10);
	service.wrap(() => worker(instanceId));
}
