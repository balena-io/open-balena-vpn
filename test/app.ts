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

import '../src/init.js';

import Bluebird from 'bluebird';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import http from 'http';
import _ from 'lodash';
import nock from 'nock';
import vpnClient from 'openvpn-client';

chai.use(chaiAsPromised);
const { expect } = chai;

import { apiServer } from '../src/api.js';
import { service } from '../src/utils/service.js';
import type { VpnManager } from '../src/utils/openvpn.js';

import proxyWorker from '../src/proxy-worker.js';
import vpnWorker from '../src/vpn-worker.js';
import { BALENA_API_INTERNAL_HOST, VPN_API_PORT } from '../src/utils/config.js';
import { optionalVar } from '@balena/env-parsing';
import { pooledRequest } from '../src/utils/request.js';

const vpnHost = optionalVar('VPN_HOST', '127.0.0.1');
const vpnPort = optionalVar('VPN_PORT', '443');
const caCertPath = optionalVar('CA_CERT_PATH', '/etc/openvpn/ca.crt');

let instance: typeof service;
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
	listenAsync(port: number): Promise<HttpServerAsync>;
	closeAsync(): Promise<HttpServerAsync>;
}

const expectTraceParent = (headers: Record<string, string>) => {
	// Check that we are forwarding the traceparent header
	expect(headers).to.have.property('traceparent').that.is.a('string');
};
const checkTraceParentReturningBody = (body: nock.Body) =>
	function (this: nock.ReplyFnContext) {
		expectTraceParent(this.req.headers);
		return body;
	};

// We check the lack of traceparent for certain things because the internal service instance heartbeat loop does not have a trace
// and the proxy-worker connect method also does not have a trace
const checkNoTraceParentReturningBody = (body: nock.Body) =>
	function (this: nock.ReplyFnContext) {
		expect(this.req.headers).to.not.have.property('traceparent');
		return body;
	};

after(() => {
	manager?.stop();
});

describe('vpn worker', function () {
	this.timeout(15 * 1000);

	before(() => {
		nock(BALENA_API_INTERNAL_HOST)
			.post('/v6/service_instance')
			.reply(200, checkNoTraceParentReturningBody({ id: _.random(1, 1024) }));
	});

	it('should resolve true when ready', async () => {
		instance = await service.register();
		manager = await vpnWorker(1, instance.getId());
	});
});

describe('tunnel worker', () =>
	it('should startup successfully', () => {
		proxyWorker(1, instance.getId());
	}));

describe('api server', () =>
	it('should startup successfully', async () => {
		await apiServer(instance.getId()).listenAsync(VPN_API_PORT);
	}));

describe('VPN Events', function () {
	this.timeout(30 * 1000);

	const getEvent = (name: string) =>
		new Promise<string>((resolve) => {
			nock(BALENA_API_INTERNAL_HOST)
				.post(`/services/vpn/client-${name}`, /"uuids":.*"user2"/g)
				.reply(200, function (_uri, body) {
					expectTraceParent(this.req.headers);
					resolve(body as string);
					return 'OK';
				});
		});

	before(() => {
		nock(BALENA_API_INTERNAL_HOST)
			.get('/services/vpn/auth/user2')
			.reply(200, checkTraceParentReturningBody('OK'));
	});

	it('should send a client-connect event', async function () {
		const connectEvent = getEvent('connect');
		this.client = vpnClient.create(vpnDefaultOpts);
		this.client.authenticate('user2', 'pass');
		await this.client.connect();
		const body = await connectEvent;
		expect(body).to.have.property('serviceId').that.equals(instance.getId());
		expect(body).to.have.property('uuids').that.deep.equals(['user2']);
		expect(body).to.not.have.property('real_address');
		expect(body).to.not.have.property('virtual_address');
	});

	it('should send a client-disconnect event', async function () {
		const disconnectEvent = getEvent('disconnect');
		await this.client.disconnect();
		const body = await disconnectEvent;
		expect(body).to.have.property('serviceId').that.equals(instance.getId());
		expect(body).to.have.property('uuids').that.deep.equals(['user2']);
		expect(body).to.not.have.property('real_address');
		expect(body).to.not.have.property('virtual_address');
	});
});

describe('VPN proxy', function () {
	this.timeout(30 * 1000);

	const vpnTest = async (
		credentials: { user: string; pass: string },
		func: () => any,
	): Promise<void> => {
		const server = Bluebird.promisifyAll(
			http.createServer((_req, res) => {
				res.writeHead(200, { 'Content-type': 'text/plain' });
				res.end('hello from 8080');
			}),
		) as any as HttpServerAsync;

		await Bluebird.using(
			vpnClient.connect(credentials, vpnDefaultOpts),
			async () => {
				const s = await server.listenAsync(8080);
				await func();
				await server.closeAsync();
				return s;
			},
		);
	};

	beforeEach(() => {
		nock(BALENA_API_INTERNAL_HOST)
			.get(/\/services\/vpn\/auth\/user[345]/)
			.reply(200, checkTraceParentReturningBody('OK'))

			.post(/\/services\/vpn\/client-(?:dis)?connect/, /common_name=user[345]/g)
			.times(2)
			.reply(200, checkTraceParentReturningBody('OK'));
	});

	describe('web accessible device', () => {
		beforeEach(() => {
			nock(BALENA_API_INTERNAL_HOST)
				.get('/v6/device')
				.query({
					$select: 'id,is_connected_to_vpn',
					$filter: 'uuid eq @uuid',
					'@uuid': "'deadbeef'",
				})
				.reply(
					200,
					checkTraceParentReturningBody({
						d: [
							{
								id: 1,
								is_connected_to_vpn: 1,
							},
						],
					}),
				);

			nock(BALENA_API_INTERNAL_HOST)
				.post('/v6/device(@id)/canAccess?@id=1', {
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.reply(
					200,
					checkTraceParentReturningBody({
						d: [
							{
								id: 1,
							},
						],
					}),
				);
		});

		it('should allow port 8080 without authentication (.balena)', async () => {
			await vpnTest({ user: 'user3', pass: 'pass' }, async () => {
				const response = await pooledRequest({
					url: 'http://deadbeef.balena:8080/test',
					proxy: 'http://localhost:3128',
					tunnel: true,
				});
				expect(response).to.have.property('statusCode').that.equals(200);
				expect(response)
					.to.have.property('body')
					.that.equals('hello from 8080');
			});
		});

		it('should allow port 8080 without authentication (.resin)', async () => {
			await vpnTest({ user: 'user3', pass: 'pass' }, async () => {
				const response = await pooledRequest({
					url: 'http://deadbeef.resin:8080/test',
					proxy: 'http://localhost:3128',
					tunnel: true,
				});
				expect(response).to.have.property('statusCode').that.equals(200);
				expect(response)
					.to.have.property('body')
					.that.equals('hello from 8080');
			});
		});
	});

	describe('tunnel forwarding', () => {
		beforeEach(() => {
			nock(BALENA_API_INTERNAL_HOST)
				.get('/v6/device')
				.query({
					$select: 'id,is_connected_to_vpn',
					$filter: 'uuid eq @uuid',
					'@uuid': "'c0ffeec0ffeec0ffee'",
				})
				.reply(
					200,
					checkTraceParentReturningBody({
						d: [
							{
								id: 2,
								is_connected_to_vpn: 1,
							},
						],
					}),
				);

			nock(BALENA_API_INTERNAL_HOST)
				.post('/v6/device(@id)/canAccess?@id=2', {
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.reply(
					200,
					checkTraceParentReturningBody({
						d: [
							{
								id: 2,
							},
						],
					}),
				);
		});

		it('should refuse to forward via itself', async () => {
			nock(BALENA_API_INTERNAL_HOST)
				.get(
					'/v6/service_instance?$select=id,ip_address&$filter=manages__device/any(d:(d/uuid%20eq%20%27c0ffeec0ffeec0ffee%27)%20and%20(d/is_connected_to_vpn%20eq%20true))',
				)
				.reply(
					200,
					checkNoTraceParentReturningBody({
						d: [{ id: instance.getId(), ip_address: '127.0.0.1' }],
					}),
				);

			await vpnTest(
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

		it('should detect forward loops', async () => {
			nock(BALENA_API_INTERNAL_HOST)
				.get(
					'/v6/service_instance?$select=id,ip_address&$filter=manages__device/any(d:(d/uuid%20eq%20%27c0ffeec0ffeec0ffee%27)%20and%20(d/is_connected_to_vpn%20eq%20true))',
				)
				.reply(
					200,
					checkNoTraceParentReturningBody({
						d: [{ id: 0, ip_address: '127.0.0.1' }],
					}),
				);

			await vpnTest(
				{ user: 'user3', pass: 'pass' },
				() =>
					expect(
						pooledRequest.defaults({
							proxyHeaderWhiteList: ['Forwarded'],
						} as any)({
							url: 'http://c0ffeec0ffeec0ffee.balena:8080/test',
							headers: {
								Forwarded: `By=open-balena-vpn(${instance.getId()})`,
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
			nock(BALENA_API_INTERNAL_HOST)
				.get('/v6/device')
				.query({
					$select: 'id,is_connected_to_vpn',
					$filter: 'uuid eq @uuid',
					'@uuid': "'deadbeef'",
				})
				.reply(
					200,
					checkTraceParentReturningBody({
						d: [
							{
								id: 3,
								is_connected_to_vpn: 1,
							},
						],
					}),
				);
		});

		it('should not allow port 8080 without authentication', async () => {
			nock(BALENA_API_INTERNAL_HOST)
				.post('/v6/device(@id)/canAccess?@id=3', {
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.reply(200, checkTraceParentReturningBody({ d: [] }));

			await vpnTest(
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

		it('should allow port 8080 with authentication', async () => {
			nock(BALENA_API_INTERNAL_HOST)
				.post('/v6/device(@id)/canAccess?@id=3', {
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.reply(
					200,
					checkTraceParentReturningBody({
						d: [
							{
								id: 3,
							},
						],
					}),
				);

			await vpnTest({ user: 'user5', pass: 'pass' }, async () => {
				const response = await pooledRequest({
					url: 'http://deadbeef.balena:8080/test',
					proxy: 'http://BALENA_api:test_api_key@localhost:3128',
					tunnel: true,
				});
				expect(response).to.have.property('statusCode').that.equals(200);
				expect(response)
					.to.have.property('body')
					.that.equals('hello from 8080');
			});
		});
	});
});
