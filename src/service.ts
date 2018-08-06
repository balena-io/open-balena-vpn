import * as Promise from 'bluebird';
import * as logger from 'winston';
import { captureException, ServiceRegistrationError } from './errors';
import { apiKey, resinApi } from './utils';

export class ServiceInstance {
	private _id: string | null = null;

	constructor(private interval: number = 10 * 1000) {}

	public register(): Promise<this> {
		return resinApi.post({
			resource: 'service_instance',
			customOptions: {
				apikey: apiKey,
			},
		})
		.then(({ id }: { id?: string }) => {
			if (id == null) {
				throw new ServiceRegistrationError('No service ID received on response');
			}
			this.id = id;
			logger.info('Registered as a service instance, received ID', id);
			return this;
		})
		.catch((err) => {
			captureException(err, 'Failed to register with API');
			// Retry until it works
			return Promise
			.delay(this.interval)
			.then(() => this.register());
		});
	}

	public scheduleHeartbeat(): Promise<boolean> {
		return Promise
		.delay(this.interval)
		.bind(this)
		.then(this.sendHeartbeat)
		// Whether it worked or not, keep sending at the same interval
		.finally(this.scheduleHeartbeat);
	}

	public sendHeartbeat(): Promise<boolean> {
		return Promise.try(() =>
			resinApi.patch({
				resource: 'service_instance',
				id: this.getId(),
				body: {
					// Just indicate being online, api handles the timestamp with hooks
					is_alive: true,
				},
				customOptions: {
					apikey: apiKey,
				},
			}))
		.return(true)
		.catch((err) => {
			captureException(err, 'Failed to send a heartbeat to the API', { tags: { service_id: this.getId() } });
			return false;
		});
	}

	public wrap(func: () => void): Promise<this> {
		return this.register().tap(func).tap(() => this.scheduleHeartbeat);
	}

	public getId(): string {
		if (this._id == null) {
			throw new ServiceRegistrationError('Not Registered');
		}
		return this._id;
	}

	set id(id: string) {
		if (this._id != null) {
			throw new ServiceRegistrationError('Already Registered');
		}
		this._id = id;
	}
}

export const service = new ServiceInstance();
