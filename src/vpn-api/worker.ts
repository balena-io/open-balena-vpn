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

import { metrics } from '@balena/node-metrics-gatherer';

import { getLogger } from '../utils';

import { Metrics } from './metrics';
import { clients, HAProxy, Netmask, request, VpnManager } from './utils';
import {
	hasBytecountData,
	isTrusted,
	VpnClientBytecountData,
} from './utils/openvpn';

const BALENA_API_HOST = process.env.BALENA_API_HOST!;
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

// disable verbose logs and bytecount reporting by default
const VPN_BYTECOUNT_INTERVAL =
	parseInt(process.env.VPN_BYTECOUNT_INTERVAL!, 10) || 0;

const getInstanceSubnet = (instanceId: number) => {
	const [netBase, netMask] = VPN_BASE_SUBNET.split('/');
	const network = new Netmask(netBase, parseInt(netMask, 10));
	return network.split(VPN_INSTANCE_SUBNET_BITMASK)[instanceId - 1];
};

const worker = (instanceId: number) => {
	const clientCache: {
		[key: number]: { uuid: string; ts: number } & VpnClientBytecountData;
	} = {};
	const logger = getLogger('vpn', instanceId);

	logger.notice(`process started with pid=${process.pid}`);

	const fatalErrorHandler = (err: Error) => {
		logger.emerg(err.message);
		process.exitCode = 1;
	};

	const logStateUpdate = (state: clients.DeviceState) => {
		let stateMsg = `common_name=${state.common_name} connected=${
			state.connected
		}`;
		if (state.virtual_address != null) {
			stateMsg = `${stateMsg} virtual_address=${state.virtual_address}`;
		}
		logger.debug(`successfully updated state for device: ${stateMsg}`);
	};

	const writeBandwidthMetrics = (
		clientId: number,
		data: VpnClientBytecountData,
	) => {
		const uuid = clientCache[clientId].uuid;
		const rxDelta = data.bytes_received - clientCache[clientId].bytes_received;
		const txDelta = data.bytes_sent - clientCache[clientId].bytes_sent;
		const timeDelta = process.hrtime()[0] - clientCache[clientId].ts;
		metrics.inc(Metrics.RxBytes, rxDelta);
		metrics.inc(Metrics.TxBytes, txDelta);
		if (timeDelta > 0 && process.send != null) {
			process.send({
				type: 'bytecount',
				data: {
					uuid,
					rxBitrate: (rxDelta * 8) / timeDelta,
					txBitrate: (txDelta * 8) / timeDelta,
				},
			});
		}
		clientCache[clientId].bytes_received = data.bytes_received;
		clientCache[clientId].bytes_sent = data.bytes_sent;
		clientCache[clientId].ts += timeDelta;
	};

	let verbose = process.env.VPN_VERBOSE_LOGS === 'true';
	process.on('message', msg => {
		if (msg === 'toggleVerbosity') {
			verbose = !verbose;
			logger.notice(`verbose logging ${verbose ? 'enabled' : 'disabled'}`);
		}
	});

	const vpnPort = VPN_BASE_PORT + instanceId;
	const mgtPort = VPN_BASE_MANAGEMENT_PORT + instanceId;

	const vpn = new VpnManager(
		instanceId,
		vpnPort,
		mgtPort,
		getInstanceSubnet(instanceId),
		BALENA_VPN_GATEWAY,
	);

	vpn.on('process:exit', (code, signal) => {
		let msg = 'process exited';
		if (code != null) {
			msg = `process exited with code ${code}`;
		} else if (signal != null) {
			msg = `process terminated with signal ${signal}`;
		}
		fatalErrorHandler(new Error(msg));
	});
	vpn.on('process:error', fatalErrorHandler);

	// capture openvpn logs
	vpn.on('log', (level, message) => {
		// only log warnings (or more severe) unless verbose=true
		if (verbose || logger.levels[level] <= logger.levels.warning) {
			logger.log(level, message);
		}
	});

	vpn.on('client:connect', (clientId, keyId, data) => {
		logger.debug(`connect from client_id=${clientId} uuid=${data.username}`);
		request({
			url: `https://${BALENA_API_HOST}/services/vpn/auth/${data.username}`,
			timeout: 30000,
			headers: { Authorization: `Bearer ${data.password}` },
		})
			.then(response => {
				if (response.statusCode === 200) {
					logger.debug(
						`authentication passed for client_id=${clientId} uuid=${
							data.username
						}`,
					);
					return vpn
						.exec(`client-auth-nt ${clientId} ${keyId}`)
						.then(() =>
							logger.info(
								`authorised client_id=${clientId} uuid=${data.username}`,
							),
						);
				} else {
					logger.debug(
						`authentication failed for client_id=${clientId} uuid=${
							data.username
						}`,
					);
					metrics.inc(Metrics.AuthFailures);
					return vpn
						.exec(`client-deny ${clientId} ${keyId} "AUTH_FAILURE"`)
						.then(() =>
							logger.info(
								`rejected client_id=${clientId} uuid=${
									data.username
								} reason=AUTH_FAILURE`,
							),
						);
				}
			})
			.catch(err => {
				logger.alert(`auth error: ${err}\n${err.stack}`);
				return vpn
					.exec(`client-deny ${clientId} ${keyId} "AUTH_ERROR"`)
					.then(() =>
						logger.info(
							`rejected client_id=${clientId} uuid=${
								data.username
							} reason=AUTH_ERROR`,
						),
					);
			});
	});

	vpn.on('client:established', (clientId, data) => {
		logger.info(
			`connection established with client_id=${clientId} uuid=${data.username}`,
		);
		metrics.inc(Metrics.OnlineDevices);
		metrics.inc(Metrics.TotalDevices);
		clientCache[clientId] = {
			uuid: data.common_name,
			bytes_received: 0,
			bytes_sent: 0,
			ts: process.hrtime()[0],
		};
		clients.connected(data).then(logStateUpdate);
	});

	vpn.on('client:bytecount', (clientId, data) => {
		writeBandwidthMetrics(clientId, data);
	});

	vpn.on('client:disconnect', (clientId, data) => {
		let msg = `session ended for`;
		if (!isTrusted(data)) {
			return logger.debug(`${msg} rejected client_id=${clientId}`);
		}
		msg = `${msg} client_id=${clientId} uuid=${data.common_name}`;
		if (hasBytecountData(data) && data.time_duration > 0) {
			msg = `${msg} (len=${data.time_duration} rx=${data.bytes_received} tx=${
				data.bytes_sent
			})`;
			metrics.histogram(Metrics.SessionDuration, data.time_duration);
			writeBandwidthMetrics(clientId, data);
		}
		logger.info(msg);
		metrics.dec(Metrics.OnlineDevices);
		delete clientCache[clientId];
		clients.disconnected(data).then(logStateUpdate);
	});

	logger.notice(`starting...`);
	return (
		vpn
			.start()
			.tap(() => {
				logger.info(`openvpn process started`);
			})
			// connect to vpn management console, setup logging & bytecount reporting, then release management hold
			.bind(vpn)
			.tap(vpn.connect)
			.tap(vpn.enableLogging)
			.tap(() => vpn.enableBytecountReporting(VPN_BYTECOUNT_INTERVAL))
			.tap(vpn.releaseHold)
			.tap(() => {
				logger.info(`management hold released`);
			})
			// register as haproxy backend
			.tap(() =>
				new HAProxy('/var/run/haproxy.sock').register(
					`vpn-workers/vpn${instanceId}`,
					vpnPort,
				),
			)
			.tap(() => {
				logger.info(
					`registered as haproxy backend server vpn-workers/vpn${instanceId}`,
				);
			})
			.catch(fatalErrorHandler)
			.tap(() => {
				logger.notice(`waiting for clients...`);
			})
	);
};
export default worker;
