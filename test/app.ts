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

import * as Promise from 'bluebird';
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as http from 'http';
import * as _ from 'lodash';
import * as nock from 'nock';
import * as vpnClient from 'openvpn-client';
import * as path from 'path';
import * as querystring from 'querystring';

const { expect } = chai;

import tunnelWorker from '../src/connect-proxy/worker';
import { request, service } from '../src/vpn-api/utils';
import vpnWorker from '../src/vpn-api/worker';

const vpnHost = process.env.VPN_HOST || '127.0.0.1';
const vpnPort = process.env.VPN_PORT || '443';
const caCertPath =
	process.env.CA_CERT_PATH || path.resolve(__dirname, '../openvpn/ca.crt');
const BALENA_API_HOST = process.env.BALENA_API_HOST!;
const VPN_CONNECT_PROXY_PORT = process.env.VPN_CONNECT_PROXY_PORT!;

const vpnDefaultOpts = [
	'--client',
	'--remote',
	vpnHost,
	vpnPort,
	'--ca',
	caCertPath,
	'--dev',
	'tun',
	'--proto',
	'tcp-client',
	'--comp-lzo',
	'--verb',
	'3',
];

interface HttpServerAsync {
	listenAsync(port: number): Promise<HttpServerAsync>;
	closeAsync(): Promise<HttpServerAsync>;
}

before(() => {
	chai.use(chaiAsPromised);
});

describe('vpn worker', function() {
	this.timeout(10 * 1000);

	before(() => {
		nock(`https://${BALENA_API_HOST}`)
			.post('/v5/service_instance')
			.reply(200, { id: _.random(1, 1024) });
	});

	it('should resolve true when ready', () =>
		expect(service.register().then(() => vpnWorker(1))).to.eventually.be.true);
});

describe('tunnel worker', () =>
	it('should startup successfully', () => {
		tunnelWorker(VPN_CONNECT_PROXY_PORT);
	}));

describe('VPN Events', function() {
	this.timeout(30 * 1000);

	const getEvent = (name: string) =>
		new Promise<string>(resolve => {
			nock(`https://${process.env.BALENA_API_HOST}`)
				.post(`/services/vpn/client-${name}`, /common_name=user2/g)
				.reply(200, (_uri: string, body: any) => {
					resolve(body);
					return 'OK';
				});
		});

	before(() => {
		nock(`https://${BALENA_API_HOST}`)
			.get('/services/vpn/auth/user2')
			.reply(200, 'OK');
	});

	it('should send a client-connect event', function() {
		const connectEvent = getEvent('connect').then(body => {
			const data = querystring.parse(body);
			expect(data)
				.to.have.property('common_name')
				.that.equals('user2');
			expect(data).to.not.have.property('real_address');
			expect(data)
				.to.have.property('virtual_address')
				.that.match(/^10\.2[45][0-9]\.[0-9]+\.[0-9]+$/);
		});

		this.client = vpnClient.create(vpnDefaultOpts);
		this.client.authenticate('user2', 'pass');
		return this.client.connect().return(connectEvent);
	});

	it('should send a client-disconnect event', function() {
		const disconnectEvent = getEvent('disconnect').then(body => {
			const data = querystring.parse(body);
			expect(data)
				.to.have.property('common_name')
				.that.equals('user2');
			expect(data).to.not.have.property('real_address');
			expect(data).to.not.have.property('virtual_address');
		});

		return this.client.disconnect().return(disconnectEvent);
	});
});

describe('VPN proxy', function() {
	this.timeout(30 * 1000);

	const vpnTest = (
		credentials: { user: string; pass: string },
		func: () => any,
	): Promise<HttpServerAsync> => {
		const server = (Promise.promisifyAll(
			http.createServer((_req, res) => {
				res.writeHead(200, { 'Content-type': 'text/plain' });
				res.end('hello from 8080');
			}),
		) as any) as HttpServerAsync;

		return Promise.using(
			vpnClient.connect(
				credentials,
				vpnDefaultOpts,
			),
			() =>
				server
					.listenAsync(8080)
					.tap(() => func())
					.tap(() => server.closeAsync()),
		);
	};

	beforeEach(() => {
		nock(`https://${BALENA_API_HOST}`)
			.get(/\/services\/vpn\/auth\/user[345]/)
			.reply(200, 'OK')

			.post(/\/services\/vpn\/client-(?:dis)?connect/, /common_name=user[345]/g)
			.times(2)
			.reply(200, 'OK');
	});

	describe('web accessible device', () => {
		beforeEach(() => {
			nock(`https://${BALENA_API_HOST}`)
				.get('/v5/device')
				.query({
					$select: 'id,uuid,is_connected_to_vpn',
					$filter: "uuid eq 'deadbeef'",
				})
				.reply(200, {
					d: [
						{
							id: 1,
							uuid: 'deadbeef',
							is_connected_to_vpn: 1,
						},
					],
				});

			nock(`https://${BALENA_API_HOST}`)
				.post('/v5/device(1)/canAccess', '{"action":"tunnel-8080"}')
				.reply(200, {
					d: [
						{
							id: 1,
							uuid: 'deadbeef',
							is_connected_to_vpn: 1,
						},
					],
				});
		});

		it('should allow port 8080 without authentication (.balena)', () =>
			vpnTest({ user: 'user3', pass: 'pass' }, () =>
				request({
					url: 'http://deadbeef.balena:8080/test',
					proxy: 'http://localhost:3128',
					tunnel: true,
				}).then(response => {
					expect(response)
						.to.have.property('statusCode')
						.that.equals(200);
					expect(response)
						.to.have.property('body')
						.that.equals('hello from 8080');
				}),
			));

		it('should allow port 8080 without authentication (.resin)', () =>
			vpnTest({ user: 'user3', pass: 'pass' }, () =>
				request({
					url: 'http://deadbeef.resin:8080/test',
					proxy: 'http://localhost:3128',
					tunnel: true,
				}).then(response => {
					expect(response)
						.to.have.property('statusCode')
						.that.equals(200);
					expect(response)
						.to.have.property('body')
						.that.equals('hello from 8080');
				}),
			));
	});

	describe('not web accessible device', () => {
		beforeEach(() => {
			nock(`https://${BALENA_API_HOST}`)
				.get('/v5/device')
				.query({
					$select: 'id,uuid,is_connected_to_vpn',
					$filter: "uuid eq 'deadbeef'",
				})
				.reply(200, {
					d: [
						{
							id: 2,
							uuid: 'deadbeef',
							is_connected_to_vpn: 1,
						},
					],
				});
		});

		it('should not allow port 8080 without authentication', () => {
			nock(`https://${BALENA_API_HOST}`)
				.post('/v5/device(2)/canAccess', '{"action":"tunnel-8080"}')
				.reply(200, () => {
					return { d: [] };
				});

			return vpnTest(
				{ user: 'user4', pass: 'pass' },
				() =>
					expect(
						request({
							url: 'http://deadbeef.balena:8080/test',
							proxy: 'http://localhost:3128',
							tunnel: true,
						}),
					).to.eventually.be.rejected,
			);
		});

		it('should allow port 8080 with authentication', () => {
			nock(`https://${BALENA_API_HOST}`)
				.post('/v5/device(2)/canAccess', '{"action":"tunnel-8080"}')
				.reply(200, {
					d: [
						{
							id: 2,
							uuid: 'deadbeef',
							is_connected_to_vpn: 1,
						},
					],
				});

			return vpnTest({ user: 'user5', pass: 'pass' }, () =>
				request({
					url: 'http://deadbeef.balena:8080/test',
					proxy: 'http://BALENA_api:test_api_key@localhost:3128',
					tunnel: true,
				}).then(response => {
					expect(response)
						.to.have.property('statusCode')
						.that.equals(200);
					expect(response)
						.to.have.property('body')
						.that.equals('hello from 8080');
				}),
			);
		});
	});
});
