express = require 'express'
bodyParser = require 'body-parser'
morgan = require 'morgan'
Netmask = require('netmask').Netmask
_ = require 'lodash'
Promise = require 'bluebird'
request = Promise.promisify(require('requestretry'))

{ OpenVPNSet } = require './libs/openvpn-nc'
{ requestQueue } = require './libs/request-queue'

envKeys = [
	'RESIN_API_HOST'
	'VPN_SERVICE_API_KEY'
	'VPN_HOST'
	'VPN_MANAGEMENT_NEW_PORT'
	'VPN_MANAGEMENT_PORT'
	'VPN_PRIVILEGED_SUBNET'
	'VPN_SUBNET'
]

{ env } = process

fatal = (msg) ->
	console.error(msg)
	process.exit(1)

fatal("#{k} env var not set") for k in envKeys when !env[k]

# Require once we know we have sufficient env vars.
privileged = require './privileged'

vpnSubnet = new Netmask(env.VPN_SUBNET)

# Basic sanity check.
if !vpnSubnet.contains(env.VPN_PRIVILEGED_SUBNET)
	fatal("Privileged IP subnet/24 #{env.VPN_PRIVILEGED_SUBNET} isn't on the VPN subnet #{env.VPN_SUBNET}")

managementPorts = [ env.VPN_MANAGEMENT_PORT, env.VPN_MANAGEMENT_NEW_PORT ]
vpn = new OpenVPNSet(managementPorts, env.VPN_HOST)

queue = requestQueue(
	maxAttempts: 3600
	retryDelay: 1000
)

module.exports = app = express()

notFromVpnClients = (req, res, next) ->
	if vpnSubnet.contains(req.ip) and !privileged.contains(req.ip)
		return res.sendStatus(401)

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
	if not req.body.common_name?
		return res.sendStatus(400)
	if not req.body.virtual_address?
		return res.sendStatus(400)
	if not req.body.real_address?
		return res.sendStatus(400)
	data = _.pick(req.body, [ 'common_name', 'virtual_address', 'real_address' ])
	queue.push(
		url: "https://#{env.RESIN_API_HOST}/services/vpn/client-connect?apikey=#{env.VPN_SERVICE_API_KEY}"
		method: "post"
		form: data
	)
	res.send('OK')

## Private endpoints, each of these should use the `fromLocalHost` middleware.

fromLocalHost = (req, res, next) ->
	if req.ip isnt '127.0.0.1'
		return res.sendStatus(401)

	next()

app.post '/api/v1/auth/', fromLocalHost, (req, res) ->
	if not req.body.username?
		return res.sendStatus(400)
	if not req.body.password?
		return res.sendStatus(400)
	username = req.body.username
	apiKey = req.body.password
	requestOpts =
		url: "https://#{env.RESIN_API_HOST}/services/vpn/auth/#{username}"
		qs: { apiKey }
		retryDelay: 2000
	request(requestOpts).get(0)
	.then (response) ->
		if response.statusCode == 200
			res.send('OK')
		else
			throw new Error('Authentication failed.')
	.catch (e) ->
		console.log('authentication failed', e)
		res.sendStatus(401)
	

app.delete '/api/v1/clients/', fromLocalHost, (req, res) ->
	if not req.body.common_name?
		return res.sendStatus(400)
	if not req.body.virtual_address?
		return res.sendStatus(400)
	if not req.body.real_address?
		return res.sendStatus(400)
	data = _.pick(req.body, [ 'common_name', 'virtual_address', 'real_address' ])
	queue.push(
		url: "https://#{env.RESIN_API_HOST}/services/vpn/client-disconnect?apikey=#{env.VPN_SERVICE_API_KEY}"
		method: "post"
		form: data
	)
	res.send('OK')

app.post '/api/v1/privileged/ip', fromLocalHost, (req, res) ->
	{ common_name } = req.body
	if not common_name?
		return res.sendStatus(400)

	ip = privileged.assign(common_name)
	return res.sendStatus(501) if !ip?

	res.send(ip)

app.delete '/api/v1/privileged/ip', fromLocalHost, (req, res) ->
	{ ip } = req.body
	return res.sendStatus(400) if not ip?

	privileged.unassign(ip)
	# We output a message if unassigned ip provided, but this shouldn't be an error.
	res.send('OK')

app.get '/api/v1/privileged/ip', fromLocalHost, (req, res) ->
	res.send(privileged.list())

app.get '/api/v1/privileged/peer', fromLocalHost, (req, res) ->
	peer = privileged.peer(req.query.ip)
	if peer?
		res.send(peer)
	else
		res.sendStatus(400)

app.listen(80)

# Now endpoints are established, release VPN hold.
vpn.execCommand('hold release')
