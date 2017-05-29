Promise = require 'bluebird'
logger = require 'winston'
{ resinApi, apiKey } = require './utils'

INTERVAL = 10e3

serviceId = null
exports.getId = -> serviceId

exports.register = ->
	resinApi.post
		resource: 'service_instance'
		customOptions:
			apikey: apiKey
	.then ({ id }) ->
		if !id
			throw new Error('No service ID received on response')

		logger.info('Registered as a service instance, received ID', id)
		serviceId = id
	.catch (err) ->
		logger.error('Failed to register on API:', err.message)
		# Retry until it works
		Promise.delay(INTERVAL).then(exports.register)

exports.scheduleHeartbeat = ->
	Promise.delay(INTERVAL)
	.then(exports.sendHeartbeat)
	# Whether it worked or not, keep sending at the same interval
	.finally(exports.scheduleHeartbeat)

# Exposed only so that it can be tested properly
exports.sendHeartbeat = ->
	resinApi.patch
		resource: 'service_instance'
		id: serviceId
		body:
			# Just indicate being online, api handles the timestamp with hooks
			is_alive: true
		customOptions:
			apikey: apiKey
	.then ->
		logger.info('Sent a successful heartbeat request to the API')
	.catch (err) ->
		logger.error('Failed to send a heartbeat with id', serviceId, 'to the API:', err.message)
