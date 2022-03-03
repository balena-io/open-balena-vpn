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
import { setTimeout } from 'timers/promises';

import { getLogger } from './utils';

import { HAProxy, Metrics, Netmask, VpnManager } from './utils';
import { VpnClientBytecountData } from './utils/openvpn';

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

// milliseconds
const DEFAULT_SIGTERM_TIMEOUT =
	parseInt(process.env.DEFAULT_SIGTERM_TIMEOUT!, 10) * 1000;

// disable verbose logs and bytecount reporting by default
const VPN_BYTECOUNT_INTERVAL =
	parseInt(process.env.VPN_BYTECOUNT_INTERVAL!, 10) || 0;

const getInstanceSubnet = (instanceId: number) => {
	const [netBase, netMask] = VPN_BASE_SUBNET.split('/');
	const network = new Netmask(netBase, parseInt(netMask, 10));
	return network.split(VPN_INSTANCE_SUBNET_BITMASK)[instanceId - 1];
};

/**
 * This "flattens" a string. It instantiates it in its own memory and removes references
 * to other strings, eg in the case of a substring it is stored as a reference into that
 * larger string and will block garbage collection of that larger string by default.
 * Usually that is more performant as substrings will usually be short lived but in the
 * case of a long lived substring it can result in unnecessary memory usage.
 */
const flatstr = (s: string): string => Buffer.from(s).toString();

const worker = async (instanceId: number, serviceId: number) => {
	const logger = getLogger('vpn', serviceId, instanceId);

	logger.notice(`process started with pid=${process.pid}`);

	const fatalErrorHandler = (err: Error) => {
		logger.emerg(err.message);
		process.exit(1);
	};

	const clientCache: {
		[key: number]: { uuid: string; ts: number } & VpnClientBytecountData;
	} = {};
	const writeBandwidthMetrics = (
		clientId: number,
		data: VpnClientBytecountData,
	) => {
		if (clientCache[clientId] == null) {
			logger.warning(
				`unable to write bandwidth metrics for unknown client_id=${clientId}`,
			);
			return;
		}
		const uuid = clientCache[clientId].uuid;
		const rxDelta = data.bytes_received - clientCache[clientId].bytes_received;
		const txDelta = data.bytes_sent - clientCache[clientId].bytes_sent;
		const timeDelta = process.hrtime()[0] - clientCache[clientId].ts;
		metrics.inc(Metrics.RxBytes, rxDelta);
		metrics.inc(Metrics.RxBytesByUuid, rxDelta, { device_uuid: uuid });
		metrics.inc(Metrics.TxBytes, txDelta);
		metrics.inc(Metrics.TxBytesByUuid, txDelta, { device_uuid: uuid });
		if (timeDelta > 0 && process.send != null) {
			process.send({
				type: 'bitrate',
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
	process.on('message', (msg) => {
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
		verbose,
	);

	vpn.on('log', (level, message) => {
		if (verbose || logger.levels[level] <= logger.levels.warning) {
			logger.log(level, message);
		}
	});

	vpn.on('process:exit', (code, signal) => {
		let msg = `openvpn process (pid=${vpn.pid()})`;
		if (code != null) {
			msg = `${msg} exited (code=${code})`;
		} else if (signal != null) {
			msg = `${msg} terminated (signal=${signal})`;
		} else {
			msg = `${msg} exited`;
		}
		fatalErrorHandler(new Error(msg));
	});

	vpn.on('process:error', fatalErrorHandler);

	vpn.on('client:established', (clientId, data) => {
		logger.info(
			`connection established with client_id=${clientId} uuid=${data.username}`,
		);
		clientCache[clientId] = {
			// We need to flatten the uuid because otherwise it's a sliced string and keeps the
			// original, rather large, string in memory forever
			uuid: flatstr(data.common_name),
			bytes_received: 0,
			bytes_sent: 0,
			ts: process.hrtime()[0],
		};
	});

	vpn.on('client:bytecount', (clientId, data) => {
		writeBandwidthMetrics(clientId, data);
	});

	try {
		logger.notice('starting...');
		await vpn.start();
		logger.info(`openvpn process (pid=${vpn.pid()}) started`);
		// connect to vpn management console, setup bytecount reporting, then release management hold
		await vpn.connect();
		await vpn.enableBytecountReporting(VPN_BYTECOUNT_INTERVAL);
		await vpn.releaseHold();
		logger.info(`management hold released`);
		// register as haproxy backend
		await new HAProxy('/var/run/haproxy.sock').register(
			`vpn-workers/vpn${instanceId}`,
			vpnPort,
		);
		logger.info(
			`registered as haproxy backend server vpn-workers/vpn${instanceId}`,
		);
	} catch (err) {
		fatalErrorHandler(err);
	}

	process.on('message', async (msg) => {
		if (msg === 'prepareShutdown') {
			logger.notice(`received: ${msg}`);

			const clientCount = Object.keys(clientCache).length;

			if (clientCount > 0) {
				const delayMs = DEFAULT_SIGTERM_TIMEOUT / clientCount;
				logger.info(
					`disconnecting ${clientCount} clients, spaced by ${delayMs}ms`,
				);
				let timeToKill = DEFAULT_SIGTERM_TIMEOUT;

				for (let clientId = 0; clientId < clientCount; clientId++) {
					try {
						const cn = clientCache[clientId].uuid;
						logger.info(`disconnecting ${cn}`);
						await vpn.killClient(cn);
					} catch (err) {
						logger.warning(`'${err}' error trying to disconnect client`);
					}
					// last client disconnected
					if (clientCount - clientId === 1) {
						logger.info(
							`${clientCount} client(s) disconnected, waiting for SIGKILL`,
						);
						// ensure workers are not restarted by service manager
						await setTimeout(DEFAULT_SIGTERM_TIMEOUT * 2);
					}
					await setTimeout(delayMs);
					timeToKill = timeToKill - delayMs;
				}
			} else {
				logger.info(`${clientCount} clients connected, waiting for SIGKILL`);
				await setTimeout(DEFAULT_SIGTERM_TIMEOUT * 2);
			}
		}
	});

	logger.notice(`waiting for clients...`);
	return vpn;
};
export default worker;
