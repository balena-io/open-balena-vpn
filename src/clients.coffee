# Notify the resin API about openVPN client events
# like client connect and client disconnect
#
# The requests to API are sent through a request queue
# that retries sending the request,
# and if it fails it notifies API that all states must be resend.
#
# Reset does not happen by actually resending all the events,
# the API has a special endpoint that first sets all clients as offline.

Promise = require 'bluebird'
logger = require 'winston'
_ = require 'lodash'

{ captureException } = require './errors'
{ getPostWorker } = require './libs/post-pool'
{ getId } = require './service'

REQUEST_TIMEOUT = 60000

setDeviceState = do ->
	deviceStates = {}
	applyState = (uuid) ->
		deviceStates[uuid].promise = deviceStates[uuid].promise.then ->
			# Get the latest target state at the start of the request
			{ targetState, currentState } = deviceStates[uuid]
			if _.isEqual(targetState, currentState)
				# If the states match then we don't have to do anything
				return
			eventType = if targetState.connected then 'connect' else 'disconnect'
			Promise.using getPostWorker(), (postAsync) ->
				postAsync(
					url: "https://#{process.env.RESIN_API_HOST}/services/vpn/client-#{eventType}?apikey=#{process.env.VPN_SERVICE_API_KEY}"
					timeout: REQUEST_TIMEOUT
					form: _.extend({ service_id: getId() }, targetState)
				)
				.timeout(REQUEST_TIMEOUT)
			.spread (response) ->
				if response.statusCode != 200
					throw new Error("Status code was '#{response.statusCode}', expected '200'")
				# Update the current state on success
				deviceStates[uuid].currentState = targetState
				stateMsg = "common_name=#{targetState.common_name} connected=#{targetState.connected}"
				if targetState.virtual_address?
					stateMsg = "#{stateMsg} virtual_address=#{targetState.virtual_address}"
				logger.info(targetState)
				logger.info("Successfully updated state for #{uuid}: #{stateMsg}")
			.catch (err) ->
				captureException(err, 'Error updating state', user: uuid: uuid)
				# Add a 60 second delay in case of failure to avoid a crazy flood
				Promise.delay(60000)
				.then ->
					# Trigger another apply, to retry the failed update
					applyState(uuid)
					# Since we are recursing and this function always extends
					# the promise chain (deviceStates[uuid].promise.then ->..)
					# we need to return undefined to make this promise resolve
					# and let it continue with the recursion. If we just
					# returned applyState() instead, the whole thing would
					# deadlock
					return

	return (state) ->
		uuid = state.common_name
		deviceStates[uuid] ?=
			targetState: {}
			currentState: {}
			promise: Promise.resolve()
		deviceStates[uuid].targetState = state
		applyState(uuid)
		return

exports.connected = (data) ->
	logger.info("#{data.common_name}: connected", data)
	data = _.pick(data, 'common_name', 'virtual_address')
	data.connected = true
	setDeviceState(data)

exports.disconnected = (data) ->
	logger.info("#{data.common_name}: disconnected", data)
	data = _.pick(data, 'common_name')
	data.connected = false
	setDeviceState(data)
