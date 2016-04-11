# Notify the resin API about openVPN client events
# like client connect and client disconnect
#
# The requests to API are sent through a request queue
# that retries sending the request,
# and if it fails it notifies API that all states must be resend.
#
# Reset does not happen by actually resending all the events,
# the API has a special endpoint that first sets all clients as offline.

requestQueue = require 'requestqueue'
logger = require 'winston'

logResponse = (event, uuid) ->
	logPrefix = if uuid then "#{uuid}: #{event}" else event
	(err, response, body) ->
		if err or response.statusCode >= 400
			logger.error(logPrefix, 'fail. status code:', response.statusCode, 'body', body)
		else
			logger.info(logPrefix, 'success. status code:', response.statusCode)

exports.resetAll = resetAll = ->
	logger.info('reset-all triggered')
	queue.clear()
	queue.push(
		url: "https://#{process.env.RESIN_API_HOST}/services/vpn/reset-all?apikey=#{process.env.VPN_SERVICE_API_KEY}"
		method: 'post'
		callback: logResponse('reset-all')
	)

queue = requestQueue(
	maxAttempts: 3600
	retryDelay: 1000
	errorHandler: resetAll
)

exports.connected = (data) ->
	logger.info("#{data.common_name}: connected", data)
	queue.push(
		url: "https://#{process.env.RESIN_API_HOST}/services/vpn/client-connect?apikey=#{process.env.VPN_SERVICE_API_KEY}"
		method: 'post'
		form: data
		callback: logResponse('client-connect', data.common_name)
	)

exports.disconnected = (data) ->
	logger.info("#{data.common_name}: disconnected", data)
	queue.push(
		url: "https://#{process.env.RESIN_API_HOST}/services/vpn/client-disconnect?apikey=#{process.env.VPN_SERVICE_API_KEY}"
		method: 'post'
		form: data
		callback: logResponse('client-disconnect', data.common_name)
	)
