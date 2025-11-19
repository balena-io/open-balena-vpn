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

import _ from 'lodash';
import { metrics } from '@balena/node-metrics-gatherer';
import { setTimeout } from 'timers/promises';
import {
	DEFAULT_SIGTERM_TIMEOUT,
	MAXIMUM_DRAIN_DELAY,
	VPN_BASE_IP,
	VPN_BASE_MANAGEMENT_PORT,
	VPN_BASE_MASK,
	VPN_BASE_PORT,
	VPN_BYTECOUNT_INTERVAL,
	VPN_GATEWAY,
	VPN_INSTANCE_SUBNET_BITMASK,
	VPN_VERBOSE_LOGS,
} from './utils/config.js';

import { getLogger } from './utils/index.js';
import { VpnManager, type VpnClientBytecountData } from './utils/openvpn.js';
import { Netmask } from './utils/netmask.js';
import { Metrics } from './utils/metrics.js';
import { HAProxy } from './utils/haproxy.js';
import type { BitrateMessage } from './app.js';

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

	const clientCache = new Map<
		number,
		{
			uuid: string;
			ts: number;
			bytes_received: number;
			bytes_sent: number;
		}
	>();
	const writeBandwidthMetrics = (
		clientId: number,
		data: VpnClientBytecountData,
	) => {
		const clientEntry = clientCache.get(clientId);
		if (clientEntry == null) {
			logger.warning(
				`unable to write bandwidth metrics for unknown client_id=${clientId}`,
			);
			return;
		}
		const bytesReceived = parseInt(data.bytes_received, 10);
		const bytesSent = parseInt(data.bytes_sent, 10);
		const uuid = clientEntry.uuid;
		const rxDelta = bytesReceived - clientEntry.bytes_received;
		const txDelta = bytesSent - clientEntry.bytes_sent;
		const timeDelta = process.hrtime()[0] - clientEntry.ts;
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
			} satisfies BitrateMessage);
		}
		clientEntry.bytes_received = bytesReceived;
		clientEntry.bytes_sent = bytesSent;
		clientEntry.ts += timeDelta;
	};

	let verbose = VPN_VERBOSE_LOGS;
	process.on('message', (msg) => {
		if (msg === 'toggleVerbosity') {
			verbose = !verbose;
			logger.notice(`verbose logging ${verbose ? 'enabled' : 'disabled'}`);
		}
	});

	const drainConnections = _.once(async () => {
		logger.info(`setting haproxy for '${instanceId}' into drain mode`);
		await new HAProxy('/var/run/haproxy.sock').drain(
			`vpn-workers/vpn${instanceId}`,
		);

		const clientCount = clientCache.size;

		if (verbose) {
			logger.info(
				`clientCache: ${JSON.stringify(Object.fromEntries(clientCache))} clientCount: ${clientCount}`,
			);
		}

		if (clientCount > 0) {
			logger.info(
				`attempt to drain ${clientCount} connected clients in ${DEFAULT_SIGTERM_TIMEOUT}ms`,
			);
			const delayMs = Math.min(
				MAXIMUM_DRAIN_DELAY,
				DEFAULT_SIGTERM_TIMEOUT / clientCount,
			);
			logger.info(
				`connection draining ${clientCount} clients, spaced by ${delayMs}ms`,
			);
			for (const { uuid: cn } of clientCache.values()) {
				// Trigger the disconnecting the client in the background so as to avoid it delaying
				// the overall cadence of disconnections but whilst still having error handling for it
				void (async () => {
					try {
						logger.info(`connection draining ${cn}`);
						await vpn.killClient(cn);
					} catch (err) {
						logger.warning(`${err} while killing ${cn} on worker ${serviceId}`);
					}
				})();

				// Wait for the delay before moving on to the next client
				await setTimeout(delayMs);
			}
		}

		// all clients disconnected
		logger.info(`${clientCount} client(s) disconnected, signalling cluster`);

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
	});

	for (const eventType of [`SIGINT`, `uncaughtException`, `SIGTERM`]) {
		process.on(eventType, drainConnections);
	}

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
			`connection established with client_id=${clientId} uuid=${data.common_name}`,
		);
		clientCache.set(clientId, {
			// We need to flatten the uuid because otherwise it's a sliced string and keeps the
			// original, rather large, string in memory forever
			uuid: flatstr(data.common_name),
			bytes_received: 0,
			bytes_sent: 0,
			ts: process.hrtime()[0],
		});
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
				logger.info(
					`clientCache: ${JSON.stringify(Object.fromEntries(clientCache))}`,
				);
			}

			await drainConnections();
		}
	});

	logger.notice(`waiting for clients...`);
	return vpn;
};
export default worker;
