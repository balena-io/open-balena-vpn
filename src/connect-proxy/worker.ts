import * as Promise from 'bluebird';
import { Middleware, Tunnel } from 'node-tunnel';
import * as logger from 'winston';

import { captureException, HandledTunnelingError, Raven } from '../errors';
import * as device from './device';

[
	'VPN_SERVICE_API_KEY',
]
	.filter((key) => process.env[key] == null)
	.forEach((key, idx, keys) => {
		console.error(`${key} env variable is not set.`);
		if (idx === (keys.length - 1)) {
			process.exit(1);
		}
	});

const VPN_SERVICE_API_KEY = process.env.VPN_SERVICE_API_KEY!;

const tunnelToDevice: Middleware = (req, cltSocket, _head, next) =>
	Promise.try(() => {
		if (req.url == null) {
			throw new Error('Bad Request');
		}

		const match = req.url.match(/^([a-fA-F0-9]+).resin(?::([0-9]+))?$/);
		if (match == null) {
			throw new Error(`Invalid hostname: ${req.url}`);
		}
		const [ , uuid, port = '80' ] = match;
		Raven.setContext({user: {uuid}});
		logger.info('tunnel requested for', uuid, port);

		return device.getDeviceByUUID(uuid, VPN_SERVICE_API_KEY)
		.then((data) => {
			if (data == null) {
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
	.catch(HandledTunnelingError, (err: HandledTunnelingError) => {
		console.error('Tunneling Error -', err.message);
	})
	.catch((err: Error) => {
		captureException(err, 'tunnel catch');
		cltSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
	});

const worker = (port: string) => {
	console.log(`connect-proxy worker process started with pid ${process.pid}`);
	const tunnel = new Tunnel();
	tunnel.use(tunnelToDevice);
	tunnel.listen(port, () => logger.info('tunnel listening on port', port));
	tunnel.on('connect', (hostname, port) => logger.info('tunnel opened to', hostname, port));
	tunnel.on('error', (err) => console.error('failed to connect to device', err.message || err, err.stack));
	return tunnel;
};
export default worker;
