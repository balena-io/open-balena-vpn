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

import { expect } from 'chai';

import { service } from '../src/utils/service.js';
import { apiHostname, mockApi } from './mock-api.js';

const serviceId = 10;

export default () => {
	describe('id', () => {
		before(async () => {
			await mockApi
				.forPost('/v7/service_instance')
				.forHostname(apiHostname)
				.thenJson(200, { id: serviceId });
		});

		it('should throw error when service is not registered', () => {
			expect(() => service.getId()).to.throw('Not Registered');
		});

		it('should return the service id once registered on the api', async () => {
			await service.register();
			expect(service.getId()).to.equal(serviceId);
		});
	});

	describe('sendHeartbeat()', () => {
		let called = 0;
		let isAlive = false;

		before(async () => {
			await mockApi
				.forPatch(`/v7/service_instance(${serviceId})`)
				.forHostname(apiHostname)
				.thenCallback(async (req) => {
					called++;
					const body = (await req.body.getJson()) as { is_alive: boolean };
					isAlive = body.is_alive;
					return { statusCode: 200, body: 'OK' };
				});
		});

		it('should trigger a patch request on service_instance using PineJS', async () => {
			const registered = await service.sendHeartbeat();
			expect(registered).to.be.equal(true);
			expect(called).to.equal(1);
			expect(isAlive).to.be.equal(true);
		});
	});
};
