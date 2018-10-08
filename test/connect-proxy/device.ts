/*
	Copyright (C) 2018 Resin.io Ltd.

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

import * as Promise from 'bluebird';
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as nock from 'nock';

import { getDeviceByUUID, isAccessible } from '../../src/connect-proxy/device';

const { expect } = chai;
nock.disableNetConnect();

before(() => {
	chai.use(chaiAsPromised);
});

beforeEach(function() {
	this.mockDevice = {
		id: 1234,
		uuid: 'deadbeef',
		is_web_accessible: false,
		is_connected_to_vpn: false,
		__metadata: {
			uri: '/resin/device(1234)',
			type: '',
		},
	};
});

const getAuth = (username: string, password: string) => ({username, password});

describe('getDeviceByUUID()', function() {
	beforeEach(function() {
		nock(`https://${process.env.RESIN_API_HOST}:443`)
		.get('/v4/device')
		.query({
			$select: 'id,uuid,is_web_accessible,is_connected_to_vpn',
			$filter: "uuid eq 'deadbeef'",
			apikey: 'test-api-key',
		})
		.reply(200, {d: [ this.mockDevice ]});
	});

	afterEach(() => nock.cleanAll());

	it('should return a promise', () => {
		const device = getDeviceByUUID('deadbeef', 'test-api-key');
		expect(device).to.be.an.instanceOf(Promise);
	});

	it('should resolve to the device requested', function() {
		const device = getDeviceByUUID('deadbeef', 'test-api-key');
		expect(device).to.eventually.deep.equal(this.mockDevice);
	});
});

describe('isAccessible()', () => {
	it('should allow access for the api on port 80', function() {
		const access = isAccessible(this.mockDevice, '80', getAuth('resin_api', process.env.API_SERVICE_API_KEY!));
		expect(access).to.equal(true);
	});

	it('should allow access for the api on port 22', function() {
		const access = isAccessible(this.mockDevice, '22', getAuth('resin_api', process.env.API_SERVICE_API_KEY!));
		expect(access).to.equal(true);
	});

	it('should allow access for the api on port 22222', function() {
		const access = isAccessible(this.mockDevice, '22222', getAuth('resin_api', process.env.API_SERVICE_API_KEY!));
		expect(access).to.equal(true);
	});
	it('should allow access for the api (using vpn key) on port 80', function() {
		const access = isAccessible(this.mockDevice, '80', getAuth('resin_api', process.env.VPN_SERVICE_API_KEY!));
		expect(access).to.equal(true);
	});

	it('should allow access for the api (using vpn key) on port 22', function() {
		const access = isAccessible(this.mockDevice, '22', getAuth('resin_api', process.env.VPN_SERVICE_API_KEY!));
		expect(access).to.equal(true);
	});

	it('should allow access for the api (using vpn key) on port 22222', function() {
		const access = isAccessible(this.mockDevice, '22222', getAuth('resin_api', process.env.VPN_SERVICE_API_KEY!));
		expect(access).to.equal(true);
	});

	it('should disallow access when device is inaccessible', function() {
		this.mockDevice.is_web_accessible = false;
		const access = isAccessible(this.mockDevice, '80');
		expect(access).to.equal(false);
	});

	it('should allow access for the proxy on port 22222', function() {
		const access = isAccessible(this.mockDevice, '22222', getAuth('resin_proxy', process.env.PROXY_SERVICE_API_KEY!));
		expect(access).to.equal(true);
	});

	it('should disallow unauthorized access on port 22222', function() {
		this.mockDevice.is_web_accessible = true;
		const access = isAccessible(this.mockDevice, '22222');
		expect(access).to.equal(false);
	});

	it('should disallow access when port is not allowed', function() {
		this.mockDevice.is_web_accessible = true;
		const access = isAccessible(this.mockDevice, '22');
		expect(access).to.equal(false);
	});

	it('should allow access on port 80', function() {
		this.mockDevice.is_web_accessible = true;
		const access = isAccessible(this.mockDevice, '80');
		expect(access).to.equal(true);
	});

	it('should allow access on port 8080', function() {
		this.mockDevice.is_web_accessible = true;
		const access = isAccessible(this.mockDevice, '8080');
		expect(access).to.equal(true);
	});
});
