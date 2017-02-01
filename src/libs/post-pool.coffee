Promise = require 'bluebird'
genericPool = require 'generic-pool'
postAsync = Promise.promisify(require('request').post, multiArgs: true)

factory =
	create: Promise.method ->
		# wrap the postAsync function to make each worker we create distinguishable to the pool
		return -> postAsync(arguments...)
	destroy: Promise.method ->

opts =
	max: process.env.MAX_API_POST_WORKERS
	idleTimeoutMillis: Infinity

postPool = genericPool.createPool(factory, opts)


exports.getPostWorker = ->
	Promise.resolve(postPool.acquire())
	.disposer (postAsync) ->
		postPool.release(postAsync)