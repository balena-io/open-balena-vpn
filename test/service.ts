import * as chai from 'chai';
import * as nock from 'nock';

import { service } from '../src/service';

const RESIN_API_HOST = process.env.RESIN_API_HOST!;
const VPN_SERVICE_API_KEY = process.env.VPN_SERVICE_API_KEY!;

const { expect } = chai;

const serviceId = 10;

describe('id', () => {
	before(() => {
		nock(`https://${RESIN_API_HOST}`)
		.post('/v4/service_instance')
		.query({apikey: VPN_SERVICE_API_KEY})
		.reply(200, { id: serviceId });
	});

	it('should throw error when service is not registered', () => {
		expect(() => service.getId()).to.throw('Not Registered');
	});

	it('should return the service id once registered on the api', () =>
		service.register()
		.then(() =>
			expect(service.getId()).to.equal(serviceId)
		)
	);
});

describe('sendHeartbeat()', () => {
	let called = 0;
	let isAlive = false;

	before(() => {
		nock(`https://${RESIN_API_HOST}`)
		.patch(`/v4/service_instance(${serviceId})`)
		.query({ apikey: VPN_SERVICE_API_KEY })
		.reply(200, (_uri: string, body: any) => {
			called++;
			isAlive = body.is_alive;
			return 'OK';
		});
	});

	it('should trigger a patch request on service_instance using PineJS', () =>
		service.sendHeartbeat()
		.then((registered) => {
			expect(registered).to.be.equal(true);
			expect(called).to.equal(1);
			expect(isAlive).to.be.equal(true);
		})
	);
});
