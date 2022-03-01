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
import { setTimeout } from 'timers/promises';
import { Logger } from 'winston';

import { apiKey, captureException } from './index';
import { pooledRequest } from './request';

const BALENA_API_HOST = process.env.BALENA_API_HOST!;
const REQUEST_TIMEOUT = 60000;

export interface DeviceStateTracker {
	promise: Promise<void>;
	currentConnected?: boolean;
	targetConnected: boolean;
}

export const setConnected = (() => {
	const deviceStates: { [key: string]: DeviceStateTracker } = {};

	const applyState = (serviceId: number, uuid: string, logger: Logger) =>
		(deviceStates[uuid].promise = deviceStates[uuid].promise.then(async () => {
			// Get the latest target state at the start of the request
			const { targetConnected, currentConnected } = deviceStates[uuid];
			if (targetConnected === currentConnected) {
				// If the states match then we don't have to do anything
				return;
			}

			const eventType = targetConnected ? 'connect' : 'disconnect';
			try {
				const response: IncomingMessage = await pooledRequest
					.post({
						url: `https://${BALENA_API_HOST}/services/vpn/client-${eventType}`,
						timeout: REQUEST_TIMEOUT,
						form: {
							service_id: serviceId,
							common_name: uuid,
							connected: targetConnected,
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
				deviceStates[uuid].currentConnected = targetConnected;
				logger.debug(
					`successfully updated state for device: uuid=${uuid} connected=${targetConnected}`,
				);
				return;
			} catch (err) {
				captureException(err, 'device-state-update-error', {
					tags: { uuid },
				});
				// Add a 60 second delay in case of failure to avoid a crazy flood
				await setTimeout(60000);
				// Trigger another apply, to retry the failed update
				applyState(serviceId, uuid, logger);
				// Since we are recursing and this function always extends
				// the promise chain (deviceStates[uuid].promise.then ->..)
				// we need to return to make this promise resolve
				// and let it continue with the recursion. If we just
				// returned applyState() instead or awaited it, the whole thing would
				// deadlock
				return;
			}
		}));

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
				promise: Promise.resolve(),
			};
		} else {
			deviceStates[uuid].targetConnected = connected;
		}
		applyState(serviceId, uuid, logger);
	};
})();
