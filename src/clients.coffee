# Notify the resin API about openVPN client events
# like client connect and client disconnect
#
# The requests to API are sent through a request queue
# that retries sending the request,
# and if it fails it notifies API that all states must be resend.
#
# Reset does not happen by actually resending all the events,
# the API has a special endpoint that first sets all clients as offline.

{ requestQueue } = require './libs/request-queue'

queue = requestQueue(
	maxAttempts: 3600
	retryDelay: 1000
	errorHandler: resetAll
)

exports.resetAll = resetAll = ->
	queue.clear()
	queue.push(
		url: "https://#{process.env.RESIN_API_HOST}/services/vpn/reset-all?apikey=#{process.env.VPN_SERVICE_API_KEY}"
		method: "post"
	)

exports.connected = (data) ->
	queue.push(
		url: "https://#{process.env.RESIN_API_HOST}/services/vpn/client-connect?apikey=#{process.env.VPN_SERVICE_API_KEY}"
		method: "post"
		form: data
	)

exports.disconnected = (data) ->
	queue.push(
		url: "https://#{process.env.RESIN_API_HOST}/services/vpn/client-disconnect?apikey=#{process.env.VPN_SERVICE_API_KEY}"
		method: "post"
		form: data
	)
