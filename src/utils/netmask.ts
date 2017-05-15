import * as netmask from 'netmask';

export class Netmask extends netmask.Netmask {
	// The second usable address of the block
	second: string;
	// The third usable address of the block
	third: string;

	constructor(net: string, mask: number) {
		if (mask > 29) {
			throw new Error(`Mask /${mask} is too small, 3 usable addresses are required.`);
		}
		super(net, `${mask}`);
		this.second = netmask.long2ip(netmask.ip2long(this.first) + 1);
		this.third = netmask.long2ip(netmask.ip2long(this.first) + 2);
	}

	split(mask: number): Netmask[] {
		if (mask < this.bitmask) {
			throw new Error(`Cannot split /${this.bitmask} into /${mask}!`);
		}
		let net = new Netmask(this.base, mask);
		const subnets = [];
		while (true) {
			if (!this.contains(net)) {
				break;
			}
			subnets.push(net);
			net = net.next() as Netmask;
		}
		return subnets;
	}
}
