express = require 'express'
bodyParser = require 'body-parser'
morgan = require 'morgan'
_ = require 'lodash'

{ OpenVPNSet } = require './libs/openvpn-nc'
{ requestQueue } = require './libs/request-queue'

envKeys = [
	'API_ENDPOINT'
	'API_KEY'
	'API_VPN_IP'
	'VPN_HOST'
	'VPN_MANAGEMENT_NEW_PORT'
	'VPN_MANAGEMENT_PORT'
	'VPN_SUBNET_24'
]

{ env } = process

fatal = (msg) ->
	console.error(msg)
	process.exit(1)

fatal("#{k} env var not set") for k in envKeys when !env[k]

managementPorts = [ env.VPN_MANAGEMENT_PORT, env.VPN_MANAGEMENT_NEW_PORT ]
vpn = new OpenVPNSet(managementPorts, env.VPN_HOST)

queue = requestQueue(
	maxAttempts: 3600
	retryDelay: 1000
)

module.exports = app = express()

notFromVpnClients = (req, res, next) ->
	if req.ip.split('.')[0] is env.VPN_SUBNET_24 and req.ip isnt env.API_VPN_IP
		return res.send(401)
	else
		next()

app.use(morgan('combined', skip: (req) -> req.url is '/ping'))
app.use(bodyParser.json())
app.use(notFromVpnClients)

app.get '/api/v1/clients/', (req, res) ->
	vpn.getStatus()
	.then (results) ->
		res.send(_.values(results.client_list))
	.catch (error) ->
		console.error('Error getting VPN client list', error)
		res.send(500, 'Error getting VPN client list')

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
		url: "#{env.API_ENDPOINT}/services/vpn/client-connect?apikey=#{env.API_KEY}"
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
		url: "#{env.API_ENDPOINT}/services/vpn/client-disconnect?apikey=#{env.API_KEY}"
		method: "post"
		form: data
	)
	res.send('OK')

app.listen(80)
