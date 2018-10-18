/*
	Copyright (C) 2018 Resin.io Ltd.

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
import * as compression from 'compression';
import * as express from 'express';
import * as forever from 'forever-monitor';
import * as morgan from 'morgan';
import * as net from 'net';

import apiFactory from './api';
import { captureException, Raven } from './errors';
import { logger, Netmask } from './utils';

interface AsyncApplication extends express.Application {
	listenAsync(port: number): Promise<ReturnType<express.Application['listen']>>;
}

[
	'RESIN_API_HOST',
	'VPN_SERVICE_API_KEY',
	'VPN_HOST',
	'VPN_API_BASE_PORT',

	'VPN_BASE_SUBNET',
	'VPN_BASE_PORT',
	'VPN_BASE_MANAGEMENT_PORT',
	'VPN_INSTANCE_SUBNET_BITMASK',
]
	.filter((key) => process.env[key] == null)
	.forEach((key, idx, keys) => {
		logger.error(`${key} env variable is not set.`);
		if (idx === (keys.length - 1)) {
			process.exit(1);
		}
	});

const RESIN_VPN_GATEWAY = process.env.RESIN_VPN_GATEWAY;
const VPN_BASE_SUBNET = process.env.VPN_BASE_SUBNET!;
const VPN_INSTANCE_SUBNET_BITMASK = parseInt(process.env.VPN_INSTANCE_SUBNET_BITMASK!, 10);
const VPN_BASE_PORT = parseInt(process.env.VPN_BASE_PORT!, 10);
const VPN_BASE_MANAGEMENT_PORT = parseInt(process.env.VPN_BASE_MANAGEMENT_PORT!, 10);
const VPN_API_BASE_PORT = parseInt(process.env.VPN_API_BASE_PORT!, 10);

const getInstanceSubnet = (instanceId: number) => {
	const [ netBase, netMask ] = VPN_BASE_SUBNET.split('/');
	const net = new Netmask(netBase, parseInt(netMask, 10));
	return net.split(VPN_INSTANCE_SUBNET_BITMASK)[instanceId - 1];
};

const worker = (instanceId: number) => {
	logger.info(`worker-${instanceId} process started with pid ${process.pid}`);

	const vpnPort = VPN_BASE_PORT + instanceId;
	const mgtPort = VPN_BASE_MANAGEMENT_PORT + instanceId;
	const apiPort = VPN_API_BASE_PORT + instanceId;

	const subnet = getInstanceSubnet(instanceId);
	const gateway = RESIN_VPN_GATEWAY || subnet.first;
	const command = [
		'/usr/sbin/openvpn',
		'--status', `/run/openvpn/server-${instanceId}.status`, '10',
		'--cd', '/etc/openvpn',
		'--config', '/etc/openvpn/server.conf',
		'--dev', `tun${instanceId}`,
		'--port', `${vpnPort}`,
		'--management', '127.0.0.1', `${mgtPort}`,
		'--ifconfig', gateway, subnet.second,
		'--ifconfig-pool', subnet.third, subnet.last,
		'--route', subnet.base, subnet.mask,
		'--push', `route ${gateway}`,
		'--auth-user-pass-verify', `scripts/auth-resin.sh ${instanceId}`, 'via-env',
		'--client-connect', `scripts/client-connect.sh ${instanceId}`,
		'--client-disconnect', `scripts/client-disconnect.sh ${instanceId}`];
	const openvpn = new forever.Monitor(command, {
		uid: `openvpn_${instanceId}`,
		env: process.env,
		max: 10,
		spinSleepTime: 1000,
	})
	.on('exit', (err) => {
		logger.error('OpenVPN error:', err.message);
		captureException(err, 'OpenVPN Error');
		process.exit(2);
	});

	const app = Promise.promisifyAll(express()) as any as AsyncApplication;
	app.disable('x-powered-by');
	app.get('/ping', (_req, res) => res.send('OK'));
	app.use(morgan('combined'));
	app.use(compression());
	app.use(apiFactory());
	app.use(Raven.errorHandler());

	return app.listenAsync(apiPort)
	.tap(() => logger.info(`resin-vpn worker-${instanceId} listening on port ${apiPort}`))
	.tap(() => openvpn.start())
	.tap(() => net.createConnection('/var/run/haproxy.sock', function(this: net.Socket) {
		this.on('error', (err) => {
			logger.error('Error connecting to haproxy socket:', err.message);
			process.exit(1);
		});
		const preamble = `set server vpn-cluster/vpn${instanceId}`;
		this.write(`${preamble} addr 127.0.0.1 port ${vpnPort}\r\n${preamble} state ready\r\n`, () => this.destroy());
	}))
	.return(true);
};
export default worker;
