/*
	Copyright (C) 2017 Balena Ltd.

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
import 'mocha';

import * as netmask from '../../src/utils/netmask.js';

const BASE_SIZE = 10;
const net = new netmask.Netmask('100.64.0.0', BASE_SIZE);

export default () => {
	describe('Netmask', () => {
		it('should fail on /30 or smaller subnets', () => {
			expect(() => new netmask.Netmask('100.64.0.0', 30)).to.throw(
				Error,
				'Mask /30 is too small, 3 usable addresses are required.',
			);
		});

		describe('.second', () => {
			it('should be the second usable address', () => {
				expect(net).to.have.property('second').that.equals('100.64.0.2');
			});
		});

		describe('.third', () => {
			it('should be the third usable address', () => {
				expect(net).to.have.property('third').that.equals('100.64.0.3');
			});
		});

		describe('.split', () => {
			it('should refuse if split < mask', () => {
				expect(() => net.split(BASE_SIZE - 1)).to.throw(
					Error,
					`Cannot split /${BASE_SIZE} into /${BASE_SIZE - 1}!`,
				);
			});

			it('should refuse if mask >= 30', () => {
				expect(() => net.split(30)).to.throw(
					Error,
					'Mask /30 is too small, 3 usable addresses are required.',
				);
			});

			it('should return array of Netmask instances', () => {
				for (const subnet of net.split(20)) {
					expect(subnet).to.be.instanceOf(netmask.Netmask);
					expect(subnet).to.have.property('second');
					expect(subnet).to.have.property('third');
				}
			});

			it('should allow when split == mask', () => {
				const subnets = net.split(BASE_SIZE);
				expect(subnets).to.have.property('length').that.equals(1);
				expect(subnets[0]).to.have.property('base').that.equals('100.64.0.0');
				expect(subnets[0]).to.have.property('bitmask').that.equals(BASE_SIZE);
			});

			it('should return non-overlapping subnets', () => {
				const subnets = net.split(BASE_SIZE + 1);
				expect(subnets).to.have.property('length').that.equals(2);
				expect(subnets[0]).to.have.property('base').that.equals('100.64.0.0');
				expect(subnets[0])
					.to.have.property('bitmask')
					.that.equals(BASE_SIZE + 1);
				expect(subnets[1]).to.have.property('base').that.equals('100.96.0.0');
				expect(subnets[1])
					.to.have.property('bitmask')
					.that.equals(BASE_SIZE + 1);
			});
		});
	});
};
