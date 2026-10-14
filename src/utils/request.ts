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
import PQueue from 'p-queue';

const REQUEST_TIMEOUT = 59000;

// Nothing uses the response body so it is discarded rather than buffered, but it is still consumed
// in full so that the connection can be reused and so that the timeout covers the entire request
export const request = async (
	url: string,
	init?: Omit<RequestInit, 'signal'>,
) => {
	const response = await fetch(url, {
		...init,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT),
	});
	await response.body?.pipeTo(new WritableStream());
	return response;
};

const pooledRequestQueue = new PQueue({
	concurrency: intVar('MAX_API_POST_WORKERS', 20),
});

// Pooled requests go into a promise-queue to limit concurrency in order to avoid overwhelming the API during mass auth requests
// eg during redeploys where every device reconnects
export const pooledRequest = (...args: Parameters<typeof request>) =>
	pooledRequestQueue.add(() => request(...args));
