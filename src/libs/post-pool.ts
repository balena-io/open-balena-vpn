import * as Promise from 'bluebird';
import * as genericPool from 'generic-pool';
import * as _ from 'lodash';

import { request } from '../utils';

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
	Promise.resolve(postPool.acquire())
	.disposer((worker) => postPool.release(worker));
