/*
	Copyright (C) 2026 Balena Ltd.

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

import { setConnected } from '../src/utils/clients.ts';
import { getLogger } from '../src/utils/index.ts';
import { apiHostname, mockApi } from './mock-api.ts';

const serviceId = 20;
const logger = getLogger('test', serviceId);

export default () => {
	describe('disconnectAll()', () => {
		const disconnected: string[] = [];

		before(async () => {
			await mockApi
				.forPost('/services/vpn/client-connect')
				.forHostname(apiHostname)
				.thenReply(200);
			await mockApi
				.forPost('/services/vpn/client-disconnect')
				.forHostname(apiHostname)
				.thenCallback(async (req) => {
					const body = (await req.body.getJson()) as { uuids: string[] };
					disconnected.push(...body.uuids);
					return { statusCode: 200 };
				});
		});

		it('should report every connected device as disconnected before resolving', async () => {
			setConnected('deadbeef1', serviceId, true, logger);
			setConnected('deadbeef2', serviceId, true, logger);
			await setConnected.disconnectAll(serviceId, logger, 10000);
			expect(disconnected).to.have.members(['deadbeef1', 'deadbeef2']);
		}).timeout(10000);
	});
};
