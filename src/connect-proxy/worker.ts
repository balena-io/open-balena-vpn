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

import * as Promise from 'bluebird';
import { Middleware, Tunnel } from 'node-tunnel';

import { captureException, HandledTunnelingError, Raven } from '../errors';
import { logger } from '../utils';

import * as device from './device';

[
	'VPN_SERVICE_API_KEY',
]
	.filter((key) => process.env[key] == null)
	.forEach((key, idx, keys) => {
		logger.error(`${key} env variable is not set.`);
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

		const match = req.url.match(/^([a-fA-F0-9]+).(?:resin|balena)(?::([0-9]+))?$/);
		if (match == null) {
			throw new Error(`Invalid hostname: ${req.url}`);
		}
		const [ , uuid, port = '80' ] = match;
		Raven.setContext({user: {uuid}});
		logger.info(`tunnel requested for ${uuid}:${port}`);

		// we need to use VPN_SERVICE_API_KEY here as this could be an unauthenticated request (public url)
		return device.getDeviceByUUID(uuid, VPN_SERVICE_API_KEY)
		.tap((data) => {
			if (data == null) {
				cltSocket.end('HTTP/1.0 404 Not Found\r\n\r\n');
				throw new HandledTunnelingError(`Device not found: ${uuid}`);
			}
		})
		.tap((data) =>
			device.canAccessDevice(data, parseInt(port, 10), req.auth)
			.tap((isAllowed) => {
				if (!isAllowed) {
					cltSocket.end('HTTP/1.0 407 Proxy Authorization Required\r\n\r\n');
					throw new HandledTunnelingError(`Device not accessible: ${uuid}`);
				}
			})
			.tap(() => {
				if (!data.is_connected_to_vpn) {
					cltSocket.end('HTTP/1.0 503 Service Unavailable\r\n\r\n');
					throw new HandledTunnelingError(`Device not available: ${uuid}`);
				}
			}))
		.tap(() => req.url = `${uuid}.vpn:${port}`);
	})
	.then(() => next())
	.catch(HandledTunnelingError, (err: HandledTunnelingError) => {
		logger.error('Tunneling Error -', err.message);
	})
	.catch((err: Error) => {
		captureException(err, 'tunnel catch', { req });
		cltSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
	});

const worker = (port: string) => {
	logger.info(`connect-proxy worker process started with pid ${process.pid}`);
	const tunnel = new Tunnel();
	tunnel.use(tunnelToDevice);
	tunnel.listen(port, () => logger.info('tunnel listening on port', port));
	tunnel.on('connect', (hostname, port) => logger.info('tunnel opened to', hostname, port));
	tunnel.on('error', (err) => logger.error('failed to connect to device', err.message || err, err.stack));
	return tunnel;
};
export default worker;
