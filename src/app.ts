import * as cluster from 'cluster';
import * as _ from 'lodash';
import * as os from 'os';

import { service } from './service';
import { VERSION } from './utils';
import worker from './worker';

[
	'VPN_INSTANCE_COUNT',
]
	.filter((key) => process.env[key] == null)
	.forEach((key, idx, keys) => {
		console.error(`${key} env variable is not set.`);
		if (idx === (keys.length - 1)) {
			process.exit(1);
		}
	});

const VPN_INSTANCE_COUNT = parseInt(process.env.VPN_INSTANCE_COUNT!, 10) || os.cpus().length;

if (cluster.isMaster) {
	console.log(`resin-vpn@${VERSION} master process started with pid ${process.pid}`);
	if (VPN_INSTANCE_COUNT > 1) {
		console.log(`spawning ${VPN_INSTANCE_COUNT} workers`);
		_.times(VPN_INSTANCE_COUNT, (i) => {
			const instanceId = i + 1;
			const restartWorker = (code?: number, signal?: string) => {
				if (signal != null) {
					console.error(`resin-vpn worker-${instanceId} killed with signal ${signal}`);
				}
				if (code != null) {
					console.error(`resin-vpn worker-${instanceId} exited with code ${code}`);
				}
				cluster.fork({VPN_INSTANCE_ID: instanceId}).on('exit', restartWorker);
			};
			restartWorker();
		});
	}
}

if (cluster.isWorker || VPN_INSTANCE_COUNT === 1) {
	const instanceId = parseInt(process.env.VPN_INSTANCE_ID || '1', 10);
	service.wrap(() => worker(instanceId));
}
