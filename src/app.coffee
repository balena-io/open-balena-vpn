express = require 'express'
bodyParser = require 'body-parser'
morgan = require 'morgan'
_ = require 'lodash'

OpenVPN = require './libs/openvpn-nc'
{ requestQueue } = require './libs/request-queue'

if not process.env.VPN_MANAGEMENT_PORT
	console.log('VPN_MANAGEMENT_PORT env var not set')
	process.exit(1)

if not process.env.VPN_HOST
	console.log('VPN_HOST env var not set')
	process.exit(1)

vpn = new OpenVPN(process.env.VPN_MANAGEMENT_PORT, process.env.VPN_HOST)

queue = requestQueue(
	maxAttempts: 3600
	retryDelay: 1000
)

module.exports = app = express()

app.use(morgan('combined', skip: (req) -> req.url is '/ping'))
app.use(bodyParser.json())

app.get '/api/v1/clients/', (req, res) ->
	vpn.getStatus()
	.then (results) ->
		res.send(results.client_list)
	.catch (error) ->
		console.error('Error getting VPN client list', error)

app.post '/api/v1/clients/', (req, res) ->
	if req.ip isnt '127.0.0.1'
		return res.send(401)
	if not req.body.common_name?
		return res.send(400)
	if not req.body.virtual_address?
		return res.send(400)
	if not req.body.real_address?
		return res.send(400)
	data = _.pick(req.body, [ 'common_name', 'virtual_address', 'real_address' ])
	queue.push(
		url: "#{process.env.API_ENDPOINT}/services/vpn/client-connect?apikey=#{process.env.API_KEY}"
		method: "post"
		form: data
	)
	res.send('OK')

app.delete '/api/v1/clients/', (req, res) ->
	if req.ip isnt '127.0.0.1'
		return res.send(401)
	if not req.body.common_name?
		return res.send(400)
	if not req.body.virtual_address?
		return res.send(400)
	if not req.body.real_address?
		return res.send(400)
	data = _.pick(req.body, [ 'common_name', 'virtual_address', 'real_address' ])
	queue.push(
		url: "#{process.env.API_ENDPOINT}/services/vpn/client-disconnect?apikey=#{process.env.API_KEY}"
		method: "post"
		form: data
	)
	res.send('OK')

app.listen(80)
