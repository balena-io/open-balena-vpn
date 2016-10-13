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
postAsync = Promise.promisify(require('request').post, multiArgs: true)
logger = require 'winston'
_ = require 'lodash'

logResponse = (event, uuid) ->
	logPrefix = if uuid then "#{uuid}: #{event}" else event
	(err, response, body) ->
		statusCode = response?.statusCode ? 599
		if err or statusCode >= 400
			logger.error(logPrefix, 'fail. status code:', statusCode, 'body', body)
		else
			logger.info(logPrefix, 'success. status code:', statusCode)

exports.resetAll = ->
	logger.info('reset-all triggered')
	postAsync(
		url: "https://#{process.env.RESIN_API_HOST}/services/vpn/reset-all?apikey=#{process.env.VPN_SERVICE_API_KEY}"
		timeout: 300000
	)

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
			postAsync(
				url: "https://#{process.env.RESIN_API_HOST}/services/vpn/client-#{eventType}?apikey=#{process.env.VPN_SERVICE_API_KEY}"
				timeout: 60000
				form: targetState
			)
			.spread (response) ->
				if response.statusCode != 200
					throw new Error("Status code was '#{response.statusCode}', expected '200'")
				# Update the current state on success
				deviceStates[uuid].currentState = targetState
				logger.info("Successfully updated state for '#{uuid}'")
			.catch (err) ->
				logger.error("Error updating state for '#{uuid}':", err, err.stack)
				# Add a 60 second delay in case of failure to avoid a crazy flood
				Promise.delay(60000)
				.then ->
					# Trigger another apply, to retry the failed update
					applyState(uuid)

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
