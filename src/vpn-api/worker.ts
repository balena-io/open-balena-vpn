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

import * as Promise from 'bluebird';
import * as compression from 'compression';
import * as express from 'express';
import * as forever from 'forever-monitor';
import * as _ from 'lodash';
import * as morgan from 'morgan';
import * as net from 'net';
import VpnManager = require('telnet-openvpn');

import { metrics } from '@balena/node-metrics-gatherer';

import { captureException, logger } from '../utils';
import { Raven } from '../utils/errors';

import apiFactory from './api';
import { Netmask } from './utils';

interface AsyncApplication extends express.Express {
	listenAsync(port: number): Promise<ReturnType<express.Application['listen']>>;
}

[
	'BALENA_API_HOST',
	'VPN_SERVICE_API_KEY',
	'VPN_HOST',
	'VPN_API_BASE_PORT',

	'VPN_BASE_SUBNET',
	'VPN_BASE_PORT',
	'VPN_BASE_MANAGEMENT_PORT',
	'VPN_INSTANCE_SUBNET_BITMASK',
]
	.filter(key => process.env[key] == null)
	.forEach((key, idx, keys) => {
		logger.error(`${key} env variable is not set.`);
		if (idx === keys.length - 1) {
			process.exit(1);
		}
	});

const BALENA_VPN_GATEWAY = process.env.BALENA_VPN_GATEWAY;
const VPN_BASE_SUBNET = process.env.VPN_BASE_SUBNET!;
const VPN_INSTANCE_SUBNET_BITMASK = parseInt(
	process.env.VPN_INSTANCE_SUBNET_BITMASK!,
	10,
);
const VPN_BASE_PORT = parseInt(process.env.VPN_BASE_PORT!, 10);
const VPN_BASE_MANAGEMENT_PORT = parseInt(
	process.env.VPN_BASE_MANAGEMENT_PORT!,
	10,
);
const VPN_API_BASE_PORT = parseInt(process.env.VPN_API_BASE_PORT!, 10);

const getInstanceSubnet = (instanceId: number) => {
	const [netBase, netMask] = VPN_BASE_SUBNET.split('/');
	const network = new Netmask(netBase, parseInt(netMask, 10));
	return network.split(VPN_INSTANCE_SUBNET_BITMASK)[instanceId - 1];
};

// disable bytecount reporting by default
const VPN_BYTECOUNT_INTERVAL =
	parseInt(process.env.VPN_BYTECOUNT_INTERVAL!, 10) || 0;

const worker = (instanceId: number) => {
	logger.info(`worker-${instanceId} process started with pid ${process.pid}`);

	const vpnPort = VPN_BASE_PORT + instanceId;
	const mgtPort = VPN_BASE_MANAGEMENT_PORT + instanceId;
	const apiPort = VPN_API_BASE_PORT + instanceId;

	const subnet = getInstanceSubnet(instanceId);
	const gateway = BALENA_VPN_GATEWAY || subnet.first;
	const command = [
		'/usr/sbin/openvpn',
		'--status',
		`/run/openvpn/server-${instanceId}.status`,
		'10',
		'--cd',
		'/etc/openvpn',
		'--config',
		'/etc/openvpn/server.conf',
		'--verb',
		'2',
		'--dev',
		`tun${instanceId}`,
		'--port',
		`${vpnPort}`,
		'--management',
		'127.0.0.1',
		`${mgtPort}`,
		'--management-hold',
		'--ifconfig',
		gateway,
		subnet.second,
		'--ifconfig-pool',
		subnet.third,
		subnet.last,
		'--route',
		subnet.base,
		subnet.mask,
		'--push',
		`route ${gateway}`,
		'--auth-user-pass-verify',
		`scripts/auth.sh ${instanceId}`,
		'via-env',
		'--client-connect',
		`scripts/client-connect.sh ${instanceId}`,
		'--client-disconnect',
		`scripts/client-disconnect.sh ${instanceId}`,
	];
	const openvpn = new forever.Monitor(command, {
		uid: `openvpn_${instanceId}`,
		env: process.env,
		max: 10,
		spinSleepTime: 1000,
	}).on('exit', err => {
		logger.error(`OpenVPN error: ${err.message}`);
		captureException(err, 'OpenVPN Error');
		process.exit(2);
	});
	const vpn = new VpnManager();
	// map clientid -> uuid
	const cidMap: { [key: string]: string } = {};
	// and uuid -> clientid
	const uuidMap: { [key: string]: string } = {};

	const app = Promise.promisifyAll(express()) as AsyncApplication;
	app.disable('x-powered-by');
	app.get('/ping', (_req, res) => res.send('OK'));
	app.use(morgan('combined'));
	app.use(compression());
	app.use(apiFactory());
	app.use(Raven.errorHandler());

	// setup metrics for prometheus
	const kb = 2 ** 10; // 1024
	const mb = 2 ** 10 * kb;
	const gb = 2 ** 10 * mb;
	const tb = 2 ** 10 * gb;
	const buckets = [
		kb,
		mb,
		10 * mb,
		100 * mb,
		500 * mb,
		gb,
		10 * gb,
		100 * gb,
		150 * gb,
		250 * gb,
		500 * gb,
		tb,
	];
	metrics.describe(
		'vpn_sessions_rx_bytes',
		'histogram of rx bytes per vpn session',
		{ buckets },
	);
	metrics.describe(
		'vpn_sessions_tx_bytes',
		'histogram of tx bytes per vpn session',
		{ buckets },
	);

	return app
		.listenAsync(apiPort)
		.tap(() =>
			logger.info(
				`open-balena-vpn worker-${instanceId} listening on port ${apiPort}`,
			),
		)
		.tap(() => openvpn.start())
		.delay(1000)
		.tap(() => {
			return vpn.connect({ port: mgtPort, shellPrompt: '' }).then(() => {
				vpn.connection.shellPrompt = '';
				// monitor new client connections and map cid to uuid
				vpn.on('log', data => {
					if (data.includes('CLIENT:ESTABLISHED,')) {
						const clientId = data.split(',')[1].trim();
						const idMapper = (logData: string) => {
							if (logData.includes('CLIENT:ENV,common_name=')) {
								const uuid = logData.split('=')[1].trim();
								// expire any previous mappings for this device
								if (uuidMap[uuid] != null) {
									delete cidMap[uuidMap[uuid]];
									delete uuidMap[uuid];
								}
								// register current mapping
								cidMap[clientId] = uuid;
								uuidMap[uuid] = clientId;
								logger.info(
									`Parsed connect event for client_id=${clientId} uuid=${uuid}`,
								);
								vpn.removeListener('log', idMapper);
							}
						};
						vpn.on('log', idMapper);
					}
				});
				// process bytecount events to track realtime data usage
				vpn.on('data', data => {
					if (data.bytecount_cli == null) {
						return;
					}
					const clientId = data.bytecount_cli[0];
					const uuid = cidMap[clientId];

					if (uuid == null) {
						logger.error(`Unknown CID(${clientId}) from OpenVPN!`);
						return;
					}

					const rxBytes = parseInt(data.bytecount_cli[1], 10);
					const txBytes = parseInt(data.bytecount_cli[2], 10);
					metrics.histogram('vpn_session_rx_bytes', rxBytes);
					metrics.histogram('vpn_session_tx_bytes', txBytes);
				});
				// enable bytecount/status reporting and release management hold
				return vpn
					.exec(`bytecount ${VPN_BYTECOUNT_INTERVAL}`)
					.then(() => vpn.exec('state on'))
					.then(() => vpn.exec('hold release'));
			});
		})
		.tap(() =>
			net.createConnection('/var/run/haproxy.sock', function(this: net.Socket) {
				this.on('error', err => {
					logger.error(`Error connecting to haproxy socket: ${err.message}`);
					process.exit(1);
				});
				const preamble = `set server vpn-workers/vpn${instanceId}`;
				this.write(
					`${preamble} addr 127.0.0.1 port ${vpnPort}\r\n${preamble} state ready\r\n`,
					() => this.destroy(),
				);
			}),
		)
		.return(true);
};
export default worker;
