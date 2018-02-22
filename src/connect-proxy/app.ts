import * as cluster from 'cluster';
import * as _ from 'lodash';
import * as os from 'os';

import { VERSION } from '../utils';
import worker from './worker';

[
	'VPN_CONNECT_INSTANCE_COUNT',
	'VPN_CONNECT_PROXY_PORT',
]
	.filter((key) => process.env[key] == null)
	.forEach((key, idx, keys) => {
		console.error(`${key} env variable is not set.`);
		if (idx === (keys.length - 1)) {
			process.exit(1);
		}
	});

const VPN_CONNECT_INSTANCE_COUNT = parseInt(process.env.VPN_CONNECT_INSTANCE_COUNT!, 10) || os.cpus().length;
const VPN_CONNECT_PROXY_PORT = process.env.VPN_CONNECT_PROXY_PORT!;

if (cluster.isMaster) {
	console.log(`connect-proxy@${VERSION} master process started with pid ${process.pid}`);
	if (VPN_CONNECT_INSTANCE_COUNT > 1) {
		console.log(`spawning ${VPN_CONNECT_INSTANCE_COUNT} proxy worker processes`);
		// spawn worker processes
		_.times(VPN_CONNECT_INSTANCE_COUNT, cluster.fork);
		cluster.on('exit', (worker: cluster.Worker, code: number) => {
			console.error(`proxy worker ${worker.process.pid} exited with code ${code}`);
			cluster.fork();
		});
	}
}

if (cluster.isWorker || VPN_CONNECT_INSTANCE_COUNT === 1) {
	worker(VPN_CONNECT_PROXY_PORT);
}
