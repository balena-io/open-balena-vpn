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
import * as chaiAsPromised from 'chai-as-promised';
import * as nock from 'nock';
import { BALENA_API_HOST } from '../../src/utils/config';

import { getDeviceByUUID } from '../../src/utils/device';

const { expect } = chai;
nock.disableNetConnect();

const VPN_SERVICE_API_KEY = Buffer.from(
	process.env.VPN_SERVICE_API_KEY || 'test_vpn_string',
);

before(() => {
	chai.use(chaiAsPromised);
});

beforeEach(function () {
	this.mockDevice = {
		id: 1234,
		uuid: 'deadbeef',
		is_connected_to_vpn: false,
		__metadata: {
			uri: '/resin/device(1234)',
			type: '',
		},
	};
});

describe('getDeviceByUUID()', function () {
	beforeEach(function () {
		nock(`https://${BALENA_API_HOST}`)
			.get('/v6/device')
			.query({
				$select: 'id,is_connected_to_vpn',
				$filter: 'uuid eq @uuid',
				'@uuid': "'deadbeef'",
			})
			.reply(200, { d: [this.mockDevice] });
	});

	afterEach(() => nock.cleanAll());

	it('should return a promise', () => {
		const device = getDeviceByUUID('deadbeef', VPN_SERVICE_API_KEY);
		expect(device).to.be.an.instanceOf(Promise);
	});

	it('should resolve to the device requested', function () {
		const device = getDeviceByUUID('deadbeef', VPN_SERVICE_API_KEY);
		expect(device).to.eventually.deep.equal(this.mockDevice);
	});
});
