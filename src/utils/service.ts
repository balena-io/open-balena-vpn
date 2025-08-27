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

import { setTimeout } from 'timers/promises';
import { balenaApi, getPassthrough } from './index.js';
import { VPN_SERVICE_API_KEY } from './config.js';
import { captureException, ServiceRegistrationError } from './errors.js';
import type { BalenaModel } from 'balena-sdk';

class ServiceInstance {
	private _id: number | null = null;

	constructor(private interval: number = 10 * 1000) {}

	private captureException(err: Error, fingerprint: string) {
		const tags: { [key: string]: string } = {};
		try {
			tags.instance_id = `${this.getId()}`;
		} catch {
			// ignore
		}

		captureException(err, fingerprint, { tags });
	}

	public async register(ipAddress?: string): Promise<this> {
		try {
			const body: BalenaModel['service_instance']['Write'] = {
				// @ts-expect-error we have to cast as the `ip_address` isn't usually writable but the vpn is allowed to
				ip_address: ipAddress,
			};
			const { id } = await balenaApi.post({
				resource: 'service_instance',
				passthrough: getPassthrough(`Bearer ${VPN_SERVICE_API_KEY}`),
				body,
			} as const);
			if (id == null) {
				throw new ServiceRegistrationError(
					'No service ID received on response',
				);
			}
			this.id = id;
			return this;
		} catch (err) {
			this.captureException(err, 'service-registration-error');
			await setTimeout(this.interval);
			return await this.register(ipAddress);
		}
	}

	public async scheduleHeartbeat() {
		await setTimeout(this.interval);
		try {
			await this.sendHeartbeat();
		} finally {
			void this.scheduleHeartbeat();
		}
	}

	public async sendHeartbeat() {
		try {
			await balenaApi.patch({
				resource: 'service_instance',
				id: this.getId(),
				body: {
					// @ts-expect-error The api handles the timestamp via hooks based on the `is_alive` so we can just indicate being online, however it does mean that `is_alive` doesn't actually exist in the model
					is_alive: true,
				},
				passthrough: getPassthrough(`Bearer ${VPN_SERVICE_API_KEY}`),
			});
			return true;
		} catch (err) {
			this.captureException(err, 'service-heartbeart-error');
			return false;
		}
	}

	public async wrap(
		{ ipAddress }: { ipAddress: string | undefined },
		func: (serviceInstance: this) => void,
	) {
		await this.register(ipAddress);
		func(this);
		await this.scheduleHeartbeat();
		return this;
	}

	public getId(): number {
		if (this._id == null) {
			throw new ServiceRegistrationError('Not Registered');
		}
		return this._id;
	}

	set id(id: number) {
		if (this._id != null) {
			throw new ServiceRegistrationError('Already Registered');
		}
		this._id = id;
	}
}

export const service = new ServiceInstance();
