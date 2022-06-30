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
import {
	DEFAULT_SIGTERM_TIMEOUT,
	VPN_BASE_IP,
	VPN_BASE_MANAGEMENT_PORT,
	VPN_BASE_MASK,
	VPN_BASE_PORT,
	VPN_BYTECOUNT_INTERVAL,
	VPN_GATEWAY,
	VPN_INSTANCE_SUBNET_BITMASK,
	VPN_VERBOSE_LOGS,
} from './utils/config';

import { clients, getLogger } from './utils';

import { HAProxy, Metrics, Netmask, VpnManager } from './utils';
import { VpnClientBytecountData } from './utils/openvpn';

const getInstanceSubnet = (instanceId: number) => {
	const network = new Netmask(VPN_BASE_IP, VPN_BASE_MASK);
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

	let verbose = VPN_VERBOSE_LOGS;
	process.on('message', (msg) => {
		if (msg === 'toggleVerbosity') {
			verbose = !verbose;
			logger.notice(`verbose logging ${verbose ? 'enabled' : 'disabled'}`);
		}
	});

	const drainConnections = async () => {
		const drainQueue = Object.values(clientCache);
		const clientCount = drainQueue.length;

		if (clientCount > 0) {
			logger.info(
				`attempt to drain ${clientCount} connected clients in ${DEFAULT_SIGTERM_TIMEOUT}ms`,
			);
			const delayMs = DEFAULT_SIGTERM_TIMEOUT / clientCount;
			logger.info(
				`disconnecting ${clientCount} clients, spaced by ${delayMs}ms`,
			);

			for (const client of drainQueue) {
				try {
					const cn = client.uuid;
					try {
						logger.info(`disconnecting ${cn}`);
						// update device state
						clients.setConnected(cn, serviceId, false, logger);
						// disconnect client from VPN
						await vpn.killClient(cn);
					} catch (err) {
						logger.warning(`${err} while killing ${cn} on worker ${serviceId}`);
					}
				} catch (err) {
					logger.warning(`received '${err}' trying to disconnect client`);
				}
				// otherwise keep disconnecting clients
				await setTimeout(delayMs);
			}
		}

		// all clients disconnected
		logger.info(
			`all ${clientCount} client(s) disconnected, signalling cluster`,
		);

		// signal drain status to master
		if (typeof process.send === 'function') {
			process.send({
				type: 'drain',
				data: {
					instanceId,
					finished: true,
				},
			});
		}

		// wait here, the master should exit when all workers have signaled completion
		await setTimeout(DEFAULT_SIGTERM_TIMEOUT);
		process.exit(0);
	};

	const eventTypes = [`SIGINT`, `SIGTERM`];
	eventTypes.forEach(async (eventType) => {
		process.on(eventType, await drainConnections);
	});

	const vpnPort = VPN_BASE_PORT + instanceId;
	const mgtPort = VPN_BASE_MANAGEMENT_PORT + instanceId;

	const vpn = new VpnManager(
		instanceId,
		vpnPort,
		mgtPort,
		getInstanceSubnet(instanceId),
		VPN_GATEWAY,
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

			if (verbose) {
				vpn.getStatus();
			}

			await drainConnections();
		}
	});

	logger.notice(`waiting for clients...`);
	return vpn;
};
export default worker;
