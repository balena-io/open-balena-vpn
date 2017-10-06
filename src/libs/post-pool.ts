import * as Promise from 'bluebird'
import * as genericPool from 'generic-pool'
import { post } from 'request'
const postAsync = Promise.promisify(post, { multiArgs: true })

const createFunc = () => {
	// wrap the postAsync function to make each worker we create distinguishable to the pool
	return function () {
		return postAsync.apply(null, arguments)
	} as typeof postAsync
}

const factory: genericPool.Factory<typeof postAsync> = {
	create: Promise.method(createFunc) as () => Promise<typeof postAsync>,
	destroy: Promise.method(() => {}),
}

let max: number | undefined
const { MAX_API_POST_WORKERS } = process.env
if (MAX_API_POST_WORKERS != null) {
	max = parseInt(MAX_API_POST_WORKERS)
}
const opts = {
	max: max,
	idleTimeoutMillis: Infinity,
}

const postPool = genericPool.createPool(factory, opts)


export const getPostWorker = () => {
	return Promise.resolve(postPool.acquire())
	.disposer((postAsync) => {
		postPool.release(postAsync)
	})
}