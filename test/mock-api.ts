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

import * as mockttp from 'mockttp';
import { BALENA_API_INTERNAL_HOST } from '../src/utils/config.js';

export const mockApi = mockttp.getLocal();

export const apiHostname = new URL(BALENA_API_INTERNAL_HOST).hostname;

export const startMockApi = async () => {
	await mockApi.start();

	process.env.HTTP_PROXY = mockApi.proxyEnv.HTTP_PROXY;
	process.env.HTTPS_PROXY = mockApi.proxyEnv.HTTPS_PROXY;
	process.env.NO_PROXY = 'localhost,127.0.0.1';
};

export const stopMockApi = async () => {
	await mockApi.stop();
	delete process.env.HTTP_PROXY;
	delete process.env.HTTPS_PROXY;
	delete process.env.NO_PROXY;
};
