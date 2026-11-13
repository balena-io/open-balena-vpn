/*
	Copyright (C) 2026 Balena Ltd.

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
import { execSync, spawn, type ChildProcess } from 'child_process';
import { once } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import 'mocha';

import { Netmask } from '../../src/utils/netmask.ts';
import { signalPid, VpnManager } from '../../src/utils/openvpn.ts';

export default () => {
	const vpn = new VpnManager(99, 0, 0, new Netmask('100.64.0.0', 20));
	const pidFile: string = vpn['pidFile'];
	let child: ChildProcess | undefined;
	let tmpDir: string;
	// The kernel takes comm from the exec path basename, so this symlink passes the comm check.
	let fakeOpenvpn: string;

	before(function () {
		try {
			fs.mkdirSync(path.dirname(pidFile), { recursive: true });
			fs.accessSync(path.dirname(pidFile), fs.constants.W_OK);
		} catch {
			this.skip();
		}
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-'));
		fakeOpenvpn = path.join(tmpDir, 'openvpn');
		fs.symlinkSync(execSync('command -v sleep').toString().trim(), fakeOpenvpn);
	});

	after(() => {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	afterEach(() => {
		child?.kill('SIGKILL');
		fs.rmSync(pidFile, { force: true });
	});

	it('should wait until a live orphan exits', async () => {
		child = spawn(fakeOpenvpn, ['60']);
		const pid = child.pid!;
		fs.writeFileSync(pidFile, `${pid}\n`);

		await vpn['killOrphan']();
		expect(signalPid(pid, 0)).to.equal(false);
	});

	it('should not signal a pid that another program reused', async () => {
		child = spawn('sleep', ['60']);
		const pid = child.pid!;
		fs.writeFileSync(pidFile, `${pid}\n`);

		await vpn['killOrphan']();
		expect(signalPid(pid, 0)).to.equal(true);
	});

	it('should return at once when the pid file is stale', async function () {
		this.timeout(1000);
		child = spawn('true');
		await once(child, 'exit');
		fs.writeFileSync(pidFile, `${child.pid}\n`);

		await vpn['killOrphan']();
	});
};
