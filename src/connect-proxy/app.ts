import * as Promise from 'bluebird';
import * as cluster from 'cluster';
import * as _ from 'lodash';
import { Middleware, Tunnel } from 'node-tunnel';
import * as os from 'os';
import * as logger from 'winston';

import { captureException, HandledTunnelingError, Raven } from '../errors';
import { VERSION } from '../utils';
import * as device from './device';

[
	'VPN_SERVICE_API_KEY',
	'VPN_CONNECT_PROXY_PORT',
	'VPN_CONNECT_INSTANCE_COUNT',
]
	.filter((key) => process.env[key] == null)
	.forEach((key, idx, keys) => {
		console.error(`${key} env variable is not set.`);
		if (idx === (keys.length - 1)) {
			process.exit(1);
		}
	});

const VPN_SERVICE_API_KEY = process.env.VPN_SERVICE_API_KEY!;
const VPN_CONNECT_PROXY_PORT = process.env.VPN_CONNECT_PROXY_PORT!;
const VPN_CONNECT_INSTANCE_COUNT = parseInt(process.env.VPN_CONNECT_INSTANCE_COUNT!, 10) || os.cpus().length;

const tunnelToDevice: Middleware = (req, cltSocket, _head, next) =>
	Promise.try(() => {
		if (req.url == null) {
			throw new Error('Bad Request');
		}

		const match = req.url.match(/^([a-fA-F0-9]+).resin(?::([0-9]+))?$/);
		if (match == null) {
			throw new Error(`Invalid hostname: ${req.url}`);
		}
		const uuid = match[1];
		Raven.setContext({user: {uuid}});
		let port = match[2];
		if (port == null) {
			port = '80';
		}
		logger.info('tunnel requested for', uuid, port);

		return device.getDeviceByUUID(uuid, VPN_SERVICE_API_KEY)
		.then((data) => {
			if ((data == null)) {
				cltSocket.end('HTTP/1.0 404 Not Found\r\n\r\n');
				throw new HandledTunnelingError(`Device not found: ${uuid}`);
			}
			if (!device.isAccessible(data, port, req.auth)) {
				cltSocket.end('HTTP/1.0 407 Proxy Authorization Required\r\n\r\n');
				throw new HandledTunnelingError(`Device not accessible: ${uuid}`);
			}
			if (!data.is_connected_to_vpn) {
				cltSocket.end('HTTP/1.0 503 Service Unavailable\r\n\r\n');
				throw new HandledTunnelingError(`Device not available: ${uuid}`);
			}
			req.url = `${uuid}.vpn:${port}`;
		});
	})
	.then(() => next())
	.catch(HandledTunnelingError, (err) => {
		console.error('Tunneling Error -', err.message);
	})
	.catch((err: Error) => {
		captureException(err, 'tunnel catch');
		cltSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
	});

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
	console.log(`connect-proxy@${VERSION} worker process started with pid ${process.pid}`);
	const tunnel = new Tunnel();
	tunnel.use(tunnelToDevice);
	tunnel.listen(VPN_CONNECT_PROXY_PORT, () => logger.info('tunnel listening on port', VPN_CONNECT_PROXY_PORT));
	tunnel.on('connect', (hostname, port) => logger.info('tunnel opened to', hostname, port));
	tunnel.on('error', (err) => console.error('failed to connect to device', err.message || err, err.stack));
}
