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

// Notify the API about openVPN client events
// like client connect and client disconnect
//
// The requests to API are sent through a request queue
// that retries sending the request,
// and if it fails it notifies API that all states must be resend.
//
// Reset does not happen by actually resending all the events,
// the API has a special endpoint that first sets all clients as offline.

import _ from 'lodash';
import { setTimeout } from 'timers/promises';
import type { Logger } from 'winston';

import type { Response } from './request.js';
import { request, REQUEST_TIMEOUT } from './request.js';
import {
	API_DEVICE_STATE_POST_BATCH_SIZE,
	BALENA_API_INTERNAL_HOST,
	VPN_SERVICE_API_KEY,
} from './config.js';
import { captureException } from './errors.js';
import { getPassthrough } from './index.js';

interface DeviceStateTracker {
	currentConnected?: boolean;
	targetConnected: boolean;
	currentWorkerId?: number;
	targetWorkerId: number;
}

export const setConnected = (() => {
	const deviceStates: { [key: string]: DeviceStateTracker } = {};
	const pendingUpdates = new Set<string>();

	const reportUpdates = async (
		serviceId: number,
		uuids: string[],
		connected: boolean,
		logger: Logger,
	) => {
		if (uuids.length === 0) {
			return;
		}
		const eventType = connected ? 'connect' : 'disconnect';
		const uuidChunks = _.chunk(uuids, API_DEVICE_STATE_POST_BATCH_SIZE);
		await Promise.allSettled(
			uuidChunks.map(async (uuidChunk) => {
				try {
					const response: Response = await request
						.post({
							url: `${BALENA_API_INTERNAL_HOST}/services/vpn/client-${eventType}`,
							json: true,
							body: {
								serviceId,
								uuids: uuidChunk,
								connected,
							},
							...getPassthrough(`Bearer ${VPN_SERVICE_API_KEY}`),
						})
						.promise()
						.timeout(REQUEST_TIMEOUT);
					if (response.statusCode !== 200) {
						throw new Error(
							`Status code was '${response.statusCode}', expected '200'`,
						);
					}
					// Update the current state on success
					for (const uuid of uuidChunk) {
						deviceStates[uuid].currentConnected = connected;
						// We mark the currentWorkerId to match the target since the key is that we have sent a new connect
						// event since the worker has connected in case it went from eg `us-1` -> `other-1` -> `us-2` and
						// `other` is seen as being in charge of the device when it actually should be us
						deviceStates[uuid].currentWorkerId =
							deviceStates[uuid].targetWorkerId;
						logger.debug(
							`successfully updated state for device: uuid=${uuid} connected=${connected}`,
						);
					}
					return;
				} catch (err) {
					captureException(err, 'device-state-update-error');
					for (const uuid of uuidChunk) {
						// If we failed then add the uuids back into the list of pending updates
						pendingUpdates.add(uuid);
					}
				}
			}),
		);
	};

	let currentlyReporting = false;
	const updateLoop = async (serviceId: number, logger: Logger) => {
		if (currentlyReporting || pendingUpdates.size === 0) {
			// If a report is already in progress or there are no pending updates then do nothing
			return;
		}
		try {
			currentlyReporting = true;
			const disconnects = [];
			const connects = [];
			for (const uuid of pendingUpdates) {
				const {
					targetConnected,
					currentConnected,
					targetWorkerId,
					currentWorkerId,
				} = deviceStates[uuid];
				// We only try to update those where the target/current state differs, any where it matches
				// will naturally be dropped from pending updates as expected as there is no pending update
				if (
					targetConnected !== currentConnected ||
					targetWorkerId !== currentWorkerId
				) {
					if (targetConnected) {
						connects.push(uuid);
					} else {
						disconnects.push(uuid);
					}
				}
			}
			pendingUpdates.clear();

			await Promise.allSettled([
				reportUpdates(serviceId, disconnects, false, logger),
				reportUpdates(serviceId, connects, true, logger),
			]);
		} finally {
			await setTimeout(1000);
			currentlyReporting = false;
			// Check if any pending updates have come in whilst we were reporting
			void updateLoop(serviceId, logger);
		}
	};

	return (
		uuid: string,
		serviceId: number,
		workerId: number,
		connected: boolean,
		logger: Logger,
	) => {
		if (deviceStates[uuid] == null) {
			deviceStates[uuid] = {
				currentConnected: undefined,
				targetConnected: connected,
				currentWorkerId: undefined,
				targetWorkerId: workerId,
			};
		} else {
			deviceStates[uuid].targetConnected = connected;
			deviceStates[uuid].targetWorkerId = workerId;
		}
		pendingUpdates.add(uuid);
		void updateLoop(serviceId, logger);
	};
})();
