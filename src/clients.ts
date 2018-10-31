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

import * as Promise from 'bluebird';
import { IncomingMessage } from 'http';
import * as _ from 'lodash';

import { captureException } from './errors';
import { getPostWorker } from './libs/post-pool';
import { service } from './service';
import { apiKey, logger } from './utils';

const BALENA_API_HOST = process.env.BALENA_API_HOST!;
const REQUEST_TIMEOUT = 60000;

interface DeviceStateTracker {
	promise: Promise<any>;
	currentState: Partial<DeviceState>;
	targetState: Partial<DeviceState>;
}

export interface DeviceState {
	common_name: string;
	connected: boolean;
	virtual_address?: string;
}

const setDeviceState = (() => {
	const deviceStates: { [key: string]: DeviceStateTracker } = {};

	const applyState = (uuid: string) => {
		deviceStates[uuid].promise = deviceStates[uuid].promise.then(() => {
			// Get the latest target state at the start of the request
			const { targetState, currentState } = deviceStates[uuid];
			if (_.isEqual(targetState, currentState)) {
				// If the states match then we don't have to do anything
				return;
			}

			const eventType = targetState.connected ? 'connect' : 'disconnect';
			return Promise.using(getPostWorker(), requestPost =>
				requestPost({
					url: `https://${BALENA_API_HOST}/services/vpn/client-${eventType}`,
					timeout: REQUEST_TIMEOUT,
					form: _.extend({ service_id: service.getId() }, targetState),
					headers: { Authorization: `Bearer ${apiKey}` },
				})
					.promise()
					.timeout(REQUEST_TIMEOUT),
			)
				.then((response: IncomingMessage) => {
					if (response.statusCode !== 200) {
						throw new Error(
							`Status code was '${response.statusCode}', expected '200'`,
						);
					}
					// Update the current state on success
					deviceStates[uuid].currentState = targetState;
					// Log updated state
					let stateMsg = `common_name=${targetState.common_name} connected=${
						targetState.connected
					}`;
					if (targetState.virtual_address != null) {
						stateMsg = `${stateMsg} virtual_address=${
							targetState.virtual_address
						}`;
					}
					logger.info(`Successfully updated state for ${uuid}: ${stateMsg}`);
				})
				.catch(err => {
					captureException(err, 'Error updating state', { user: { uuid } });
					// Add a 60 second delay in case of failure to avoid a crazy flood
					return Promise.delay(60000).then(() => {
						// Trigger another apply, to retry the failed update
						applyState(uuid);
						// Since we are recursing and this function always extends
						// the promise chain (deviceStates[uuid].promise.then ->..)
						// we need to return undefined to make this promise resolve
						// and let it continue with the recursion. If we just
						// returned applyState() instead, the whole thing would
						// deadlock
						return null;
					});
				});
		});
	};

	return (state: DeviceState) => {
		const uuid = state.common_name;
		if (deviceStates[uuid] == null) {
			deviceStates[uuid] = {
				targetState: {},
				currentState: {},
				promise: Promise.resolve(),
			};
		}
		deviceStates[uuid].targetState = state;
		applyState(uuid);
	};
})();

export const connected = (data: Partial<DeviceState>) => {
	logger.info(`${data.common_name}: connected`, data);
	data = _.pick(data, 'common_name', 'virtual_address');
	data.connected = true;
	return setDeviceState(data as DeviceState);
};

export const disconnected = (data: Partial<DeviceState>) => {
	logger.info(`${data.common_name}: disconnected`, data);
	data = _.pick(data, 'common_name');
	data.connected = false;
	return setDeviceState(data as DeviceState);
};
