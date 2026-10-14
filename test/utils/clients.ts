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
import { setTimeout } from 'timers/promises';

import { setConnected } from '../../src/utils/clients.js';
import { getLogger } from '../../src/utils/index.js';
import { apiHostname, mockApi } from '../mock-api.js';

const serviceId = 20;
const workerId = 1;
const logger = getLogger('vpn', serviceId);

export default () => {
	const reports: Array<{ eventType: string; uuids: string[] }> = [];

	const reportsFor = (uuid: string, eventType: string) =>
		reports.filter((r) => r.eventType === eventType && r.uuids.includes(uuid))
			.length;

	const waitForReports = async (
		uuid: string,
		eventType: string,
		count: number,
	) => {
		const start = Date.now();
		while (reportsFor(uuid, eventType) < count && Date.now() - start < 5000) {
			await setTimeout(100);
		}
		// Allow time for any further (unexpected) reports to arrive
		await setTimeout(1500);
	};

	before(async () => {
		for (const eventType of ['connect', 'disconnect']) {
			await mockApi
				.forPost(`/services/vpn/client-${eventType}`)
				.forHostname(apiHostname)
				.thenCallback(async (req) => {
					const body = (await req.body.getJson()) as { uuids: string[] };
					reports.push({ eventType, uuids: body.uuids });
					return { statusCode: 200, body: 'OK' };
				});
		}
	});

	it('should report a reconnect to the same worker while the previous session is still open', async function () {
		this.timeout(15000);
		const uuid = 'reconnect-same-worker';

		setConnected(uuid, serviceId, workerId, true, logger);
		await waitForReports(uuid, 'connect', 1);
		expect(reportsFor(uuid, 'connect')).to.equal(1);

		// Another VPN instance may have marked the device as disconnected in the meantime,
		// so the new connection must be reported again
		setConnected(uuid, serviceId, workerId, true, logger);
		await waitForReports(uuid, 'connect', 2);
		expect(reportsFor(uuid, 'connect')).to.equal(2);
		expect(reportsFor(uuid, 'disconnect')).to.equal(0);
	});

	it('should not report a duplicate disconnect', async function () {
		this.timeout(15000);
		const uuid = 'duplicate-disconnect';

		setConnected(uuid, serviceId, workerId, true, logger);
		await waitForReports(uuid, 'connect', 1);
		setConnected(uuid, serviceId, workerId, false, logger);
		await waitForReports(uuid, 'disconnect', 1);
		expect(reportsFor(uuid, 'disconnect')).to.equal(1);
		setConnected(uuid, serviceId, workerId, false, logger);
		await waitForReports(uuid, 'disconnect', 2);
		expect(reportsFor(uuid, 'disconnect')).to.equal(1);
	});
};
