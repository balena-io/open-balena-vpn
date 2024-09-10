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
import { balenaApi } from '.';
import { VPN_SERVICE_API_KEY } from './config';
import { captureException, ServiceRegistrationError } from './errors';

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
			const { id } = (await balenaApi.post({
				resource: 'service_instance',
				passthrough: {
					headers: { Authorization: `Bearer ${VPN_SERVICE_API_KEY}` },
				},
				body: ipAddress != null ? { ip_address: ipAddress } : {},
			})) as { id?: number };
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
					// Just indicate being online, api handles the timestamp with hooks
					is_alive: true,
				},
				passthrough: {
					headers: { Authorization: `Bearer ${VPN_SERVICE_API_KEY}` },
				},
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
