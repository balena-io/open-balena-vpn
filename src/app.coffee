express = require 'express'
OpenVPN = require './libs/openvpn-nc'
{ requestQueue } = require './libs/request-queue'
vpnEvents = require './openvpn-events'

module.exports = app = express()

if not process.env.VPN_MANAGEMENT_PORT
	console.log('VPN_MANAGEMENT_PORT env var not set')

if not process.env.VPN_HOST
	console.log('VPN_HOST env var not set')

vpn = new OpenVPN(process.env.VPN_MANAGEMENT_PORT, process.env.VPN_HOST)

app.get '/api/v1/clients/', (req, res) ->
	vpn.getStatus()
	.then (results) ->
		res.status(200).send(results.client_list)
	.catch (error) ->
		console.error('Error getting VPN client list', error)

app.listen(80)

queue = requestQueue(
	maxAttempts: 3600
	retryDelay: 1000
)

vpnEvents.on 'client-connect', (data) ->
	url = "#{process.env.API_ENDPOINT}/services/vpn/client-connect?apikey=#{process.env.API_KEY}"
	method = "post"
	form = data
	queue.push( { url, method, form } )

vpnEvents.on 'client-disconnect', (data) ->
	url = "#{process.env.API_ENDPOINT}/services/vpn/client-disconnect?apikey=#{process.env.API_KEY}"
	method = "post"
	form = data
	queue.push( { url, method, form } )

vpnEvents.on 'error', (err) ->
	console.log('Error reading openvpn events', err)
