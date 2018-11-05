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

import * as Promise from 'bluebird';
import * as genericPool from 'generic-pool';
import * as _ from 'lodash';
import * as rp from 'request-promise';

export const request = rp.defaults({
	resolveWithFullResponse: true,
	simple: false,
});

const postAsync = request.post;
type PostAsyncFn = typeof postAsync;

// wrap the postAsync function to make each worker we create distinguishable to the pool
const $createFunc = (): PostAsyncFn =>
	function() {
		return postAsync.apply(null, arguments);
	} as PostAsyncFn;
const createFunc = Promise.method($createFunc) as () => Promise<PostAsyncFn>;

const factory: genericPool.Factory<PostAsyncFn> = {
	create: createFunc,
	destroy: Promise.method(_.noop),
};

let max: number | undefined;
const { MAX_API_POST_WORKERS } = process.env;
if (MAX_API_POST_WORKERS != null) {
	max = parseInt(MAX_API_POST_WORKERS, 10);
}
const opts = {
	max,
	idleTimeoutMillis: Infinity,
};

const postPool = genericPool.createPool(factory, opts);

export const getPostWorker = (): Promise.Disposer<PostAsyncFn> =>
	Promise.resolve(postPool.acquire()).disposer(worker =>
		postPool.release(worker),
	);
