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

import * as netmask from 'netmask';

export class Netmask extends netmask.Netmask {
	// The second usable address of the block
	second: string;
	// The third usable address of the block
	third: string;

	constructor(net: string, mask: number) {
		if (mask > 29) {
			throw new Error(
				`Mask /${mask} is too small, 3 usable addresses are required.`,
			);
		}
		super(net, `${mask}`);
		this.second = netmask.long2ip(netmask.ip2long(this.first) + 1);
		this.third = netmask.long2ip(netmask.ip2long(this.first) + 2);
	}

	split(mask: number): Netmask[] {
		if (mask < this.bitmask) {
			throw new Error(`Cannot split /${this.bitmask} into /${mask}!`);
		}
		if (mask > 29) {
			throw new Error(
				`Mask /${mask} is too small, 3 usable addresses are required.`,
			);
		}
		let net = new Netmask(this.base, mask);
		const subnets = [];
		while (true) {
			if (!this.contains(net)) {
				break;
			}
			subnets.push(net);
			net = net.next();
		}
		return subnets;
	}

	// Override netmask.Netmask.next so it returns a Netmask (as opposed to netmask.Netmask) object
	next(count: number = 1): Netmask {
		return new Netmask(
			netmask.long2ip(this.netLong + this.size * count),
			this.bitmask,
		);
	}
}
