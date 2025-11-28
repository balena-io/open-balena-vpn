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

import { optionalVar } from '@balena/env-parsing';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { BALENA_API_INTERNAL_HOST } from '../../src/utils/config.js';

import { isDeviceConnectedToVpn } from '../../src/utils/device.js';

export default () => {
	chai.use(chaiAsPromised);
	const { expect } = chai;
	nock.disableNetConnect();

	const VPN_SERVICE_API_KEY = Buffer.from(
		optionalVar('VPN_SERVICE_API_KEY', 'test_vpn_string'),
	);

	describe('isDeviceConnectedToVpn()', function () {
		before(function () {
			nock(BALENA_API_INTERNAL_HOST)
				.get('/v7/device(@id)')
				.query({
					$select: 'id',
					$filter: 'is_connected_to_vpn',
					'@id': 1234,
				})
				.reply(200, { d: [] });
			nock(BALENA_API_INTERNAL_HOST)
				.get('/v7/device(@id)')
				.query({
					$select: 'id',
					$filter: 'is_connected_to_vpn',
					'@id': 3456,
				})
				.reply(200, { d: [{ id: 3456 }] });
		});

		after(() => {
			nock.cleanAll();
		});

		it('should return a promise that resolves to false when not connected', async () => {
			const isConnectedToVpn = isDeviceConnectedToVpn(
				1234,
				VPN_SERVICE_API_KEY,
			);
			expect(isConnectedToVpn).to.be.an.instanceOf(Promise);
			expect(await isConnectedToVpn).to.equal(false);
		});

		it('should return a promise that resolves to true when connected', async () => {
			const isConnectedToVpn = isDeviceConnectedToVpn(
				3456,
				VPN_SERVICE_API_KEY,
			);
			expect(isConnectedToVpn).to.be.an.instanceOf(Promise);
			expect(await isConnectedToVpn).to.equal(true);
		});
	});
};
