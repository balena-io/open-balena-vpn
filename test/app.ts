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

import * as Bluebird from 'bluebird';
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as http from 'http';
import * as _ from 'lodash';
import * as nock from 'nock';
import * as vpnClient from 'openvpn-client';
import * as querystring from 'querystring';

const { expect } = chai;

import { apiServer } from '../src/api';
import { pooledRequest, ServiceInstance, VpnManager } from '../src/utils';

import proxyWorker from '../src/proxy-worker';
import vpnWorker from '../src/vpn-worker';

const vpnHost = process.env.VPN_HOST || '127.0.0.1';
const vpnPort = process.env.VPN_PORT || '443';
const caCertPath = process.env.CA_CERT_PATH || '/etc/openvpn/ca.crt';
const BALENA_API_HOST = process.env.BALENA_API_HOST!;
const VPN_API_PORT = parseInt(process.env.VPN_API_PORT!, 10);

const serviceInstance = new ServiceInstance();
let manager: VpnManager;

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
	listenAsync(port: number): Bluebird<HttpServerAsync>;
	closeAsync(): Bluebird<HttpServerAsync>;
}

before(() => {
	chai.use(chaiAsPromised);
});

after(() => {
	if (manager != null) {
		manager.stop();
	}
});

describe('vpn worker', function () {
	this.timeout(15 * 1000);

	before(() => {
		nock(`https://${BALENA_API_HOST}`)
			.post('/v6/service_instance')
			.reply(200, { id: _.random(1, 1024) });
	});

	it('should resolve true when ready', async () => {
		await serviceInstance.register();
		manager = await vpnWorker(1, serviceInstance.getId());
	});
});

describe('tunnel worker', () =>
	it('should startup successfully', () => {
		proxyWorker(1, serviceInstance.getId());
	}));

describe('api server', () =>
	it('should startup successfully', () => {
		apiServer(serviceInstance.getId()).listenAsync(VPN_API_PORT);
	}));

describe('VPN Events', function () {
	this.timeout(30 * 1000);

	const getEvent = (name: string) =>
		new Bluebird<string>((resolve) => {
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

	it('should send a client-connect event', function () {
		const connectEvent = getEvent('connect').then((body) => {
			const data = querystring.parse(body);
			expect(data)
				.to.have.property('service_id')
				.that.equals(`${serviceInstance.getId()}`);
			expect(data).to.have.property('common_name').that.equals('user2');
			expect(data).to.not.have.property('real_address');
			expect(data)
				.to.have.property('virtual_address')
				.that.match(/^100\.64\.[0-9]+\.[0-9]+$/);
		});

		this.client = vpnClient.create(vpnDefaultOpts);
		this.client.authenticate('user2', 'pass');
		return this.client.connect().return(connectEvent);
	});

	it('should send a client-disconnect event', function () {
		const disconnectEvent = getEvent('disconnect').then((body) => {
			const data = querystring.parse(body);
			expect(data)
				.to.have.property('service_id')
				.that.equals(`${serviceInstance.getId()}`);
			expect(data).to.have.property('common_name').that.equals('user2');
			expect(data).to.not.have.property('real_address');
			expect(data).to.not.have.property('virtual_address');
		});

		return this.client.disconnect().return(disconnectEvent);
	});
});

describe('VPN proxy', function () {
	this.timeout(30 * 1000);

	const vpnTest = (
		credentials: { user: string; pass: string },
		func: () => any,
	): Bluebird<HttpServerAsync> => {
		const server = (Bluebird.promisifyAll(
			http.createServer((_req, res) => {
				res.writeHead(200, { 'Content-type': 'text/plain' });
				res.end('hello from 8080');
			}),
		) as any) as HttpServerAsync;

		return Bluebird.using(vpnClient.connect(credentials, vpnDefaultOpts), () =>
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
				.get('/v6/device')
				.query({
					$select: 'id,is_connected_to_vpn',
					$filter: 'uuid eq @uuid',
					'@uuid': "'deadbeef'",
				})
				.reply(200, {
					d: [
						{
							id: 1,
							is_connected_to_vpn: 1,
						},
					],
				});

			nock(`https://${BALENA_API_HOST}`)
				.post('/v6/device(@id)/canAccess?@id=1', {
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.reply(200, {
					d: [
						{
							id: 1,
						},
					],
				});
		});

		it('should allow port 8080 without authentication (.balena)', () =>
			vpnTest({ user: 'user3', pass: 'pass' }, () =>
				pooledRequest({
					url: 'http://deadbeef.balena:8080/test',
					proxy: 'http://localhost:3128',
					tunnel: true,
				}).then((response) => {
					expect(response).to.have.property('statusCode').that.equals(200);
					expect(response)
						.to.have.property('body')
						.that.equals('hello from 8080');
				}),
			));

		it('should allow port 8080 without authentication (.resin)', () =>
			vpnTest({ user: 'user3', pass: 'pass' }, () =>
				pooledRequest({
					url: 'http://deadbeef.resin:8080/test',
					proxy: 'http://localhost:3128',
					tunnel: true,
				}).then((response) => {
					expect(response).to.have.property('statusCode').that.equals(200);
					expect(response)
						.to.have.property('body')
						.that.equals('hello from 8080');
				}),
			));
	});

	describe('tunnel forwarding', () => {
		beforeEach(() => {
			nock(`https://${BALENA_API_HOST}`)
				.get('/v6/device')
				.query({
					$select: 'id,is_connected_to_vpn',
					$filter: 'uuid eq @uuid',
					'@uuid': "'c0ffeec0ffeec0ffee'",
				})
				.reply(200, {
					d: [
						{
							id: 2,
							is_connected_to_vpn: 1,
						},
					],
				});

			nock(`https://${BALENA_API_HOST}`)
				.post('/v6/device(@id)/canAccess?@id=2', {
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.reply(200, {
					d: [
						{
							id: 2,
						},
					],
				});
		});

		it('should refuse to forward via itself', () => {
			nock(`https://${BALENA_API_HOST}`)
				.get(
					'/v6/service_instance?$select=id,ip_address&$filter=manages__device/any(d:(d/uuid%20eq%20%27c0ffeec0ffeec0ffee%27)%20and%20(d/is_connected_to_vpn%20eq%20true))',
				)
				.reply(200, {
					d: [{ id: serviceInstance.getId(), ip_address: '127.0.0.1' }],
				});

			return vpnTest(
				{ user: 'user3', pass: 'pass' },
				() =>
					expect(
						pooledRequest({
							url: 'http://c0ffeec0ffeec0ffee.balena:8080/test',
							proxy: 'http://localhost:3128',
							tunnel: true,
						}),
					).to.eventually.be.rejected,
			);
		});

		it('should detect forward loops', () => {
			nock(`https://${BALENA_API_HOST}`)
				.get(
					'/v6/service_instance?$select=id,ip_address&$filter=manages__device/any(d:(d/uuid%20eq%20%27c0ffeec0ffeec0ffee%27)%20and%20(d/is_connected_to_vpn%20eq%20true))',
				)
				.reply(200, { d: [{ id: 0, ip_address: '127.0.0.1' }] });

			return vpnTest(
				{ user: 'user3', pass: 'pass' },
				() =>
					expect(
						pooledRequest.defaults({
							proxyHeaderWhiteList: ['Forwarded'],
						} as any)({
							url: 'http://c0ffeec0ffeec0ffee.balena:8080/test',
							headers: {
								Forwarded: `By=open-balena-vpn(${serviceInstance.getId()})`,
							},
							proxy: 'http://localhost:3128',
							tunnel: true,
						}),
					).to.eventually.be.rejected,
			);
		});
	});

	describe('not web accessible device', () => {
		beforeEach(() => {
			nock(`https://${BALENA_API_HOST}`)
				.get('/v6/device')
				.query({
					$select: 'id,is_connected_to_vpn',
					$filter: 'uuid eq @uuid',
					'@uuid': "'deadbeef'",
				})
				.reply(200, {
					d: [
						{
							id: 3,
							is_connected_to_vpn: 1,
						},
					],
				});
		});

		it('should not allow port 8080 without authentication', () => {
			nock(`https://${BALENA_API_HOST}`)
				.post('/v6/device(@id)/canAccess?@id=3', {
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.reply(200, () => {
					return { d: [] };
				});

			return vpnTest(
				{ user: 'user4', pass: 'pass' },
				() =>
					expect(
						pooledRequest({
							url: 'http://deadbeef.balena:8080/test',
							proxy: 'http://localhost:3128',
							tunnel: true,
						}),
					).to.eventually.be.rejected,
			);
		});

		it('should allow port 8080 with authentication', () => {
			nock(`https://${BALENA_API_HOST}`)
				.post('/v6/device(@id)/canAccess?@id=3', {
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.reply(200, {
					d: [
						{
							id: 3,
						},
					],
				});

			return vpnTest({ user: 'user5', pass: 'pass' }, () =>
				pooledRequest({
					url: 'http://deadbeef.balena:8080/test',
					proxy: 'http://BALENA_api:test_api_key@localhost:3128',
					tunnel: true,
				}).then((response) => {
					expect(response).to.have.property('statusCode').that.equals(200);
					expect(response)
						.to.have.property('body')
						.that.equals('hello from 8080');
				}),
			);
		});
	});
});
