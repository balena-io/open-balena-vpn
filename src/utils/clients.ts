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

import { IncomingMessage } from 'http';
import { Logger } from 'winston';

import { apiKey, captureException } from './index';
import { request } from './request';

const BALENA_API_HOST = process.env.BALENA_API_HOST!;
const REQUEST_TIMEOUT = 60000;

interface DeviceStateTracker {
	currentConnected?: boolean;
	targetConnected: boolean;
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
		try {
			if (uuids.length === 0) {
				return;
			}
			const eventType = connected ? 'connect' : 'disconnect';
			const response: IncomingMessage = await request
				.post({
					url: `https://${BALENA_API_HOST}/services/vpn/client-${eventType}`,
					timeout: REQUEST_TIMEOUT,
					json: true,
					body: {
						serviceId,
						uuids,
						connected,
					},
					headers: { Authorization: `Bearer ${apiKey}` },
				})
				.promise()
				.timeout(REQUEST_TIMEOUT);
			if (response.statusCode !== 200) {
				throw new Error(
					`Status code was '${response.statusCode}', expected '200'`,
				);
			}
			// Update the current state on success
			for (const uuid of uuids) {
				deviceStates[uuid].currentConnected = connected;
				logger.debug(
					`successfully updated state for device: uuid=${uuid} connected=${connected}`,
				);
			}
			return;
		} catch (err) {
			captureException(err, 'device-state-update-error');
			for (const uuid of uuids) {
				// If we failed then add the uuids back into the list of pending updates
				pendingUpdates.add(uuid);
			}
		}
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
				const { targetConnected, currentConnected } = deviceStates[uuid];
				// We only try to update those where the target/current state differs, any where it matches
				// will naturally be dropped from pending updates as expected as there is no pending update
				if (targetConnected !== currentConnected) {
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
			currentlyReporting = false;
			// Check if any pending updates have come in whilst we were reporting
			updateLoop(serviceId, logger);
		}
	};

	return (
		uuid: string,
		serviceId: number,
		connected: boolean,
		logger: Logger,
	) => {
		if (deviceStates[uuid] == null) {
			deviceStates[uuid] = {
				targetConnected: connected,
				currentConnected: undefined,
			};
		} else {
			deviceStates[uuid].targetConnected = connected;
		}
		pendingUpdates.add(uuid);
		updateLoop(serviceId, logger);
	};
})();
