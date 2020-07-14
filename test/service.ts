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

import * as chai from 'chai';
import * as nock from 'nock';

import { ServiceInstance } from '../src/utils';

const BALENA_API_HOST = process.env.BALENA_API_HOST!;

const { expect } = chai;

const serviceInstance = new ServiceInstance();
const serviceId = 10;

describe('id', () => {
	before(() => {
		nock(`https://${BALENA_API_HOST}`)
			.post('/v6/service_instance')
			.reply(200, { id: serviceId });
	});

	it('should throw error when service is not registered', () => {
		expect(() => serviceInstance.getId()).to.throw('Not Registered');
	});

	it('should return the service id once registered on the api', async () => {
		await serviceInstance.register();
		expect(serviceInstance.getId()).to.equal(serviceId);
	});
});

describe('sendHeartbeat()', () => {
	let called = 0;
	let isAlive = false;

	before(() => {
		nock(`https://${BALENA_API_HOST}`)
			.patch(`/v6/service_instance(${serviceId})`)
			.reply(200, (_uri: string, body: any) => {
				called++;
				isAlive = body.is_alive;
				return 'OK';
			});
	});

	it('should trigger a patch request on service_instance using PineJS', async () => {
		const registered = await serviceInstance.sendHeartbeat();
		expect(registered).to.be.equal(true);
		expect(called).to.equal(1);
		expect(isAlive).to.be.equal(true);
	});
});
