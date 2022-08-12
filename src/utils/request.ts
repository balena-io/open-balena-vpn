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

import { intVar } from '@balena/env-parsing';
import { Agent } from 'https';
import * as _ from 'lodash';
import * as rp from 'request-promise';
export type { Response } from 'request';

export const REQUEST_TIMEOUT = 59000;
export const request = rp.defaults({
	resolveWithFullResponse: true,
	simple: false,
	timeout: REQUEST_TIMEOUT,
});

const maxSockets = intVar('MAX_API_POST_WORKERS', 20);

const pool = new Agent({
	maxSockets,
});
export const pooledRequest = request.defaults({ pool });
