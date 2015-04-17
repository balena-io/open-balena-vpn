Promise = require 'bluebird'
requestRetry = Promise.promisify(require('requestretry'))
queue = require 'block-queue'
_ = require 'lodash'

# Create a queue for HTTP requests.
#
# Only one request is carried at every moment.
# Each request is retried until it succeeds or maxAttempts is passed.
#
# To add request task call push(options) on the result of createRequestQueue()
# Example:
# 	q = createRequestQueue()
#	q.push( { url: "http://example.org", method: "get" } )
#
# Options are same as in the "request" npm module,
# with additional maxAttempts and retryDelay options
# that are handled by "requestretry" module.
exports.requestQueue = (queueOpts = {}) ->
	queue 1, (opts, done) ->
		_.extend(opts, _.pick(queueOpts, 'maxAttempts', 'retryDelay', 'retryStrategy'))
		requestRetry(opts)
		.catch (err) ->
			if queueOpts.errorHandler
				queueOpts.errorHandler(err)
			throw err
		.nodeify(done)
