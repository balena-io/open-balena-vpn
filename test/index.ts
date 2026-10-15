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

import 'mocha';
import connectProxyTests from './connect-proxy/index.ts';
import serviceTests from './service.ts';
import utilsTests from './utils/index.ts';
import throttlingTests from './throttling.ts';
import { startMockApi, stopMockApi } from './mock-api.ts';

before(async () => {
	await startMockApi();
});

after(async () => {
	await stopMockApi();
});

describe('connect-proxy', () => {
	connectProxyTests();
});
describe('service', () => {
	serviceTests();
});
describe('utils', () => {
	utilsTests();
});
describe('throttling', () => {
	throttlingTests();
});
