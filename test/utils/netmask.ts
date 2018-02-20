import { expect } from 'chai';
import 'mocha';

import * as netmask from '../../src/utils/netmask';

const net = new netmask.Netmask('10.240.0.0', 12);

describe('Netmask', () => {
	it('should fail on /30 or smaller subnets', () => {
		expect(() => new netmask.Netmask('10.240.0.0', 30)).to.throw(Error,
			'Mask /30 is too small, 3 usable addresses are required.');
	});

	describe('.second', () => {
		it('should be the second usable address', () => {
			expect(net).to.have.property('second').that.equals('10.240.0.2');
		});
	});

	describe('.third', () => {
		it('should be the third usable address', () => {
			expect(net).to.have.property('third').that.equals('10.240.0.3');
		});
	});

	describe('.split', () => {
		it('should refuse if split < mask', () => {
			expect(() => net.split(11)).to.throw(Error, 'Cannot split /12 into /11!');
		});

		it('should allow when split == mask', () => {
			const subnets = net.split(12);
			expect(subnets).to.have.property('length').that.equals(1);
			expect(subnets[0]).to.have.property('base').that.equals('10.240.0.0');
			expect(subnets[0]).to.have.property('bitmask').that.equals(12);
		});

		it('should return non-overlapping subnets', () => {
			const subnets = net.split(13);
			expect(subnets).to.have.property('length').that.equals(2);
			expect(subnets[1]).to.have.property('base').that.equals('10.248.0.0');
			expect(subnets[1]).to.have.property('bitmask').that.equals(13);
		});
	});
});
