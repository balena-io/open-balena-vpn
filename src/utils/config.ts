/*
	Copyright (C) 2020 Balena Ltd.

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

import * as fs from 'fs';
import * as os from 'os';

export const getEnv = <T extends string>(
	...args: T[]
): { [key in T]: string } => {
	args
		.filter((key) => process.env[key] == null)
		.forEach((key, idx, keys) => {
			console.log(`${key} env variable is not set.`);
			if (idx === keys.length - 1) {
				process.exit(1);
			}
		});

	type Env = { [key in T]: string };
	const env: Partial<Env> = {};
	args.forEach((key: T) => {
		env[key] = process.env[key]!;
	});
	return env as Env;
};

// Code copied from our open source API
// https://github.com/balena-io/open-balena-api/blob/e9abe8f959c59bbeefcadbfdc59642af565b1427/src/lib/config.ts
export function intVar(varName: string): number;
export function intVar<R>(varName: string, defaultValue: R): number | R;
export function intVar<R>(varName: string, defaultValue?: R): number | R {
	if (arguments.length === 1) {
		getEnv(varName);
	}

	const s = process.env[varName];
	if (s == null) {
		return defaultValue!;
	}
	const i = parseInt(s, 10);
	if (!Number.isFinite(i)) {
		throw new Error(`${varName} must be a valid number if set`);
	}
	return i;
}

// resolve number of workers based on number of CPUs assigned to pods or available CPUs
export const getInstanceCount = (varName: string) => {
	let instanceCount = intVar(varName, null);
	if (instanceCount != null && instanceCount > 0) {
		return instanceCount;
	}
	try {
		instanceCount = parseInt(
			fs.readFileSync('/etc/podinfo/cpu_request', 'utf8'),
			10,
		);
		console.log(`Using pod info core count of: ${instanceCount}`);
	} catch (err) {
		instanceCount = os.cpus().length;
		console.log('Could not find pod info for cpu count:', err);
		console.log(`Defaulting to all cores: ${instanceCount}`);
	}
	return instanceCount;
};
