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

import '../src/init-instrumentation.js';

import Bluebird from 'bluebird';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import http from 'http';
import type { CompletedRequest } from 'mockttp';
import vpnClient from 'openvpn-client';

chai.use(chaiAsPromised);
const { expect } = chai;

import { apiServer } from '../src/api.js';
import { service } from '../src/utils/service.js';
import type { VpnManager } from '../src/utils/openvpn.js';

import proxyWorker from '../src/proxy-worker.js';
import vpnWorker from '../src/vpn-worker.js';
import { VPN_API_PORT } from '../src/utils/config.js';
import { optionalVar } from '@balena/env-parsing';
import { pooledRequest } from '../src/utils/request.js';
import { apiHostname, mockApi, startMockApi, stopMockApi } from './mock-api.js';

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

const expectTraceParent = (headers: CompletedRequest['headers']) => {
	// Check that we are forwarding the traceparent header
	expect(headers).to.have.property('traceparent').that.is.a('string');
};

const jsonOrTextResponse = (body: string | object) =>
	typeof body === 'string'
		? { statusCode: 200, body }
		: { statusCode: 200, json: body };

// `@opentelemetry/instrumentation-http` starts a (rooted, if there's no active
// span) span for every outgoing request and injects its own traceparent header
// regardless of application intent - nock never exercised this because it fully
// intercepted requests before they reached the instrumented http module, so
// those calls never carried a traceparent even where the app didn't add one
// itself. Going through a real proxy (mockttp) exercises the instrumented path
// for real, so a traceparent is always present here; only the header this app's
// own `getPassthrough()` adds is worth asserting on.
const checkTraceParentReturningBody =
	(body: string | object) => (req: CompletedRequest) => {
		expectTraceParent(req.headers);
		return jsonOrTextResponse(body);
	};

before(async () => {
	await startMockApi();
});

after(async () => {
	await stopMockApi();
	manager?.stop();
});

describe('vpn worker', function () {
	this.timeout(15 * 1000);

	before(async () => {
		await mockApi
			.forPost('/v7/service_instance')
			.forHostname(apiHostname)
			.once()
			.thenJson(200, {
				id: Math.floor(1 + Math.random() * 1023),
			});
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
		await new Promise<void>((resolve) =>
			apiServer(instance.getId()).listen(VPN_API_PORT, resolve),
		);
	}));

describe('VPN Events', function () {
	this.timeout(30 * 1000);

	// Registers the mock rule and waits for it to be active before returning,
	// since (unlike nock) mockttp rule registration is asynchronous - the
	// caller must await this before triggering the real openvpn event that
	// will hit it. Returns a thunk rather than the event promise itself,
	// since returning a promise directly from an async function makes the
	// caller's `await` chain onto it too - which would block here, before
	// the real event that resolves it has even been triggered.
	async function prepareEvent(
		name: string,
	): Promise<() => Promise<Record<string, unknown>>> {
		let resolveEvent!: (body: Record<string, unknown>) => void;
		const eventPromise = new Promise<Record<string, unknown>>((resolve) => {
			resolveEvent = resolve;
		});

		await mockApi
			.forPost(`/services/vpn/client-${name}`)
			.forHostname(apiHostname)
			.matching(async (req) =>
				/"uuids":.*"user2"/.test((await req.body.getText()) ?? ''),
			)
			.once()
			.thenCallback(async (req) => {
				expectTraceParent(req.headers);
				resolveEvent((await req.body.getJson()) as Record<string, unknown>);
				return { statusCode: 200, body: 'OK' };
			});

		return () => eventPromise;
	}

	before(async () => {
		await mockApi
			.forGet('/services/vpn/auth/user2')
			.forHostname(apiHostname)
			.once()
			.thenCallback(checkTraceParentReturningBody('OK'));
	});

	function verifyEvent(body: Record<string, unknown>) {
		expect(body).to.have.property('serviceId').that.equals(instance.getId());
		expect(body).to.have.property('uuids').that.deep.equals(['user2']);
		expect(body).to.not.have.property('real_address');
		expect(body).to.not.have.property('virtual_address');
	}

	it('should send a client-connect event', async function () {
		this.client = vpnClient.create(vpnDefaultOpts);
		this.client.authenticate('user2', 'pass');
		const getEvent = await prepareEvent('connect');
		await this.client.connect();
		verifyEvent(await getEvent());
	});

	it('should send a client-disconnect event', async function () {
		const getEvent = await prepareEvent('disconnect');
		await this.client.disconnect();
		verifyEvent(await getEvent());
	});
});

describe('More than one client', function () {
	this.timeout(30 * 1000);

	before(async () => {
		await mockApi
			.forGet(/\/services\/vpn\/auth\/user[23]/)
			.forHostname(apiHostname)
			.twice()
			.thenReply(200, 'OK');
	});
	it('should connect two clients', async function () {
		this.client = vpnClient.create(vpnDefaultOpts);
		this.client.authenticate('user2', 'pass');

		this.anotherClient = vpnClient.create(vpnDefaultOpts);
		this.anotherClient.authenticate('user3', 'pass');
		await this.client.connect();
		return this.anotherClient.connect();
	});
	it('should disconnect two clients', async function () {
		await this.client.disconnect();
		return this.anotherClient.disconnect();
	});
});

describe('VPN proxy', function () {
	this.timeout(30 * 1000);

	const vpnTest = async (
		credentials: { user: string; pass: string },
		func: () => any,
	): Promise<void> => {
		const server = http.createServer((_req, res) => {
			res.writeHead(200, { 'Content-type': 'text/plain' });
			res.end('hello from 8080');
		});

		await Bluebird.using(
			vpnClient.connect(credentials, vpnDefaultOpts),
			async () => {
				await new Promise<void>((resolve) => server.listen(8080, resolve));
				await func();
				await new Promise<void>((resolve, reject) =>
					server.close((err) => {
						if (err) {
							reject(err);
						} else {
							resolve();
						}
					}),
				);
			},
		);
	};

	beforeEach(async () => {
		// The equivalent nock rule also matched `/services/vpn/client-(dis)?connect`
		// with a `common_name=user[345]` body regex, but `setConnected` posts a JSON
		// `{ uuids: [...] }` body that never contains that text, so it never matched
		// there either - dropped rather than ported as dead weight.
		await mockApi
			.forGet(/\/services\/vpn\/auth\/user[345]/)
			.forHostname(apiHostname)
			.once()
			.thenCallback(checkTraceParentReturningBody('OK'));
	});

	describe('web accessible device', () => {
		beforeEach(async () => {
			await mockApi
				.forGet('/v7/device(@id)')
				.forHostname(apiHostname)
				.withQuery({
					$select: 'id',
					$filter: 'is_connected_to_vpn',
					'@id': '1',
				})
				.once()
				.thenCallback(
					checkTraceParentReturningBody({
						d: [
							{
								id: 1,
							},
						],
					}),
				);

			await mockApi
				.forPost('/v7/device(uuid=@uuid)/canAccess')
				.forHostname(apiHostname)
				.withQuery({ '@uuid': "'deadbeef1'" })
				.withJsonBody({
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.once()
				.thenCallback(
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
					url: 'http://deadbeef1.balena:8080/test',
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
					url: 'http://deadbeef1.resin:8080/test',
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
		beforeEach(async () => {
			await mockApi
				.forGet('/v7/device(@id)')
				.forHostname(apiHostname)
				.withQuery({
					$select: 'id',
					$filter: 'is_connected_to_vpn',
					'@id': '3',
				})
				.once()
				.thenCallback(
					checkTraceParentReturningBody({
						d: [
							{
								id: 3,
							},
						],
					}),
				);

			await mockApi
				.forPost('/v7/device(uuid=@uuid)/canAccess')
				.forHostname(apiHostname)
				.withQuery({ '@uuid': "'c0ffeec0ffeec0ffee'" })
				.withJsonBody({
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.once()
				.thenCallback(
					checkTraceParentReturningBody({
						d: [
							{
								id: 3,
							},
						],
					}),
				);
		});

		it('should refuse to forward via itself', async () => {
			const scope = await mockApi
				.forGet('/v7/service_instance')
				.forHostname(apiHostname)
				.withQuery({
					$select: 'id,ip_address',
					$filter:
						"manages__device/any(d:d/uuid eq 'c0ffeec0ffeec0ffee' and d/is_connected_to_vpn)",
				})
				.once()
				.thenJson(200, {
					d: [{ id: instance.getId(), ip_address: '127.0.0.1' }],
				});

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
			expect((await scope.getSeenRequests()).length).to.be.greaterThan(0);
		});

		it('should detect forward loops', async () => {
			const scope = await mockApi
				.forGet('/v7/service_instance')
				.forHostname(apiHostname)
				.withQuery({
					$select: 'id,ip_address',
					$filter:
						"manages__device/any(d:d/uuid eq 'c0ffeec0ffeec0ffee' and d/is_connected_to_vpn)",
				})
				.once()
				.thenJson(200, {
					d: [{ id: 0, ip_address: '127.0.0.1' }],
				});

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
			expect((await scope.getSeenRequests()).length).to.be.greaterThan(0);
		});
	});

	describe('not web accessible device', () => {
		beforeEach(async () => {
			await mockApi
				.forGet('/v7/device(@id)')
				.forHostname(apiHostname)
				.withQuery({
					$select: 'id',
					$filter: 'is_connected_to_vpn',
					'@id': '2',
				})
				.once()
				.thenCallback(
					checkTraceParentReturningBody({
						d: [
							{
								id: 2,
							},
						],
					}),
				);
		});

		it('should not allow port 8080 without authentication', async () => {
			const scope = await mockApi
				.forPost('/v7/device(uuid=@uuid)/canAccess')
				.forHostname(apiHostname)
				.withQuery({ '@uuid': "'deadbeef2'" })
				.withJsonBody({
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.once()
				.thenCallback(checkTraceParentReturningBody({ d: [] }));

			await vpnTest(
				{ user: 'user4', pass: 'pass' },
				() =>
					expect(
						pooledRequest({
							url: 'http://deadbeef2.balena:8080/test',
							proxy: 'http://localhost:3128',
							tunnel: true,
						}),
					).to.eventually.be.rejected,
			);
			expect((await scope.getSeenRequests()).length).to.be.greaterThan(0);
		});

		it('should allow port 8080 with authentication', async () => {
			const scope = await mockApi
				.forPost('/v7/device(uuid=@uuid)/canAccess')
				.forHostname(apiHostname)
				.withQuery({ '@uuid': "'deadbeef2'" })
				.withJsonBody({
					action: { or: ['tunnel-any', 'tunnel-8080'] },
				})
				.once()
				.thenCallback(
					checkTraceParentReturningBody({
						d: [
							{
								id: 2,
							},
						],
					}),
				);

			await vpnTest({ user: 'user5', pass: 'pass' }, async () => {
				const response = await pooledRequest({
					url: 'http://deadbeef2.balena:8080/test',
					proxy: 'http://BALENA_api:test_api_key@localhost:3128',
					tunnel: true,
				});
				expect(response).to.have.property('statusCode').that.equals(200);
				expect(response)
					.to.have.property('body')
					.that.equals('hello from 8080');
				expect((await scope.getSeenRequests()).length).to.be.greaterThan(0);
			});
		});
	});
});
