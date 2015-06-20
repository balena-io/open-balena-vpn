express = require 'express'
bodyParser = require 'body-parser'
compression = require 'compression'
morgan = require 'morgan'
Netmask = require('netmask').Netmask
_ = require 'lodash'
Promise = require 'bluebird'
request = Promise.promisify(require('requestretry'))
url = require 'url'
{ createTunnel, basicAuth } = require './libs/tunnel'
device = require './device'
vhost = require 'vhost'

{ OpenVPNSet } = require './libs/openvpn-nc'
clients = require './clients'

ALLOWED_PORTS = [ 80, 8080, 4200 ]

envKeys = [
	'RESIN_API_HOST'
	'VPN_SERVICE_API_KEY'
	'VPN_HOST'
	'VPN_MANAGEMENT_NEW_PORT'
	'VPN_MANAGEMENT_PORT'
	'VPN_PRIVILEGED_SUBNET'
	'VPN_SUBNET'
	'VPN_API_PORT'
	'VPN_CONNECT_PROXY_PORT'
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

vpnApi = Promise.promisifyAll(express())

notFromVpnClients = (req, res, next) ->
	if vpnSubnet.contains(req.ip) and !privileged.contains(req.ip)
		return res.sendStatus(401)

	next()

vpnApi.use(morgan('combined', skip: (req) -> req.url is '/ping'))
vpnApi.use(bodyParser.json())
vpnApi.use(notFromVpnClients)

vpnApi.get '/api/v1/clients/', (req, res) ->
	vpn.getStatus()
	.then (results) ->
		res.send(_.values(results.client_list))
	.catch (error) ->
		console.error('Error getting VPN client list', error)
		res.send(500, 'Error getting VPN client list')

vpnApi.post '/api/v1/clients/', (req, res) ->
	if not req.body.common_name?
		return res.sendStatus(400)
	if not req.body.virtual_address?
		return res.sendStatus(400)
	if not req.body.real_address?
		return res.sendStatus(400)
	if not req.body.trusted_port?
		return res.sendStatus(400)
	data = _.pick(req.body, [ 'common_name', 'virtual_address', 'real_address', 'trusted_port' ])
	clients.connected(data)
	res.send('OK')

## Private endpoints, each of these should use the `fromLocalHost` middleware.

fromLocalHost = (req, res, next) ->
	if req.ip isnt '127.0.0.1'
		return res.sendStatus(401)

	next()

vpnApi.post '/api/v1/auth/', fromLocalHost, (req, res) ->
	if not req.body.username?
		console.log('AUTH FAIL: UUID not specified.')

		return res.sendStatus(400)
	if not req.body.password?
		console.log('AUTH FAIL: API Key not specified.')

		return res.sendStatus(400)
	username = req.body.username
	apiKey = req.body.password
	requestOpts =
		url: "https://#{env.RESIN_API_HOST}/services/vpn/auth/#{username}"
		qs:
			apikey: apiKey
		retryDelay: 2000
	request(requestOpts).get(0)
	.then (response) ->
		if response.statusCode == 200
			res.send('OK')
		else
			throw new Error('Authentication failed.')
	.catch (e) ->
		console.log('AUTH FAIL: Error:', e)
		console.log('AUTH FAIL: Stack:', e?.stack)
		console.log('AUTH FAIL: UUID:', username)
		console.log('AUTH FAIL: API Key:', apiKey)

		res.sendStatus(401)


vpnApi.delete '/api/v1/clients/', fromLocalHost, (req, res) ->
	if not req.body.common_name?
		return res.sendStatus(400)
	if not req.body.virtual_address?
		return res.sendStatus(400)
	if not req.body.real_address?
		return res.sendStatus(400)
	if not req.body.trusted_port?
		return res.sendStatus(400)
	data = _.pick(req.body, [ 'common_name', 'virtual_address', 'real_address', 'trusted_port' ])
	clients.disconnected(data)
	res.send('OK')

vpnApi.post '/api/v1/privileged/ip', fromLocalHost, (req, res) ->
	{ common_name } = req.body
	if not common_name?
		return res.sendStatus(400)

	ip = privileged.assign(common_name)
	return res.sendStatus(501) if !ip?

	res.send(ip)

vpnApi.delete '/api/v1/privileged/ip', fromLocalHost, (req, res) ->
	{ ip } = req.body
	return res.sendStatus(400) if not ip?

	privileged.unassign(ip)
	# We output a message if unassigned ip provided, but this shouldn't be an error.
	res.send('OK')

vpnApi.get '/api/v1/privileged/ip', fromLocalHost, (req, res) ->
	res.send(privileged.list())

vpnApi.get '/api/v1/privileged/peer', fromLocalHost, (req, res) ->
	peer = privileged.peer(req.query.ip)
	if peer?
		res.send(peer)
	else
		res.sendStatus(400)

tunnel = createTunnel()
tunnel.use(basicAuth)

tunnel.use (req, cltSocket, head, next) ->
	Promise.try ->
		[ uuid, port ] = req.url.match(/^([a-fA-F0-9]+).resin(?::([0-9]+))?$/)[1..]
		if not uuid?
			throw new Error('Invalid hostname: ' + hostname)
		if not port?
			port = 80

		device.getDeviceByUUID(uuid, env.VPN_SERVICE_API_KEY)
		.then (data) ->
			if not device.isAccessible(data, port, req.auth)
				throw new Error('Not accessible: ' + req.url)
			req.url = data.vpn_address + ":" + port
	.then ->
		next()
	.catch (err) ->
		cltSocket.end("HTTP/1.1 502 Not Accessible\r\n\r\n")
		next(err)

tunnel.listen(env.VPN_CONNECT_PROXY_PORT)

reverseProxy = express()

reverseProxy.set('views', 'src/views')
reverseProxy.set('view engine', 'jade')

reverseProxy.use (req, res, next) ->
	if req.protocol is 'https'
		return next()
	res.redirect(301, 'https://' + req.host + req.url)

if process.env.NODE_ENV ==  'development'
	Promise.longStackTraces()
	# unescape OData queries for readability
	morgan.token('url', (req) -> decodeURIComponent(req.url))

reverseProxy.use(compression())

logFormat = if reverseProxy.get('env') is 'development' then 'dev' else 'combined'
reverseProxy.use(morgan(logFormat))

reverseProxy.use (req, res, next) ->
	req.port = port
	next()

reverseProxy.all('*', require('./route'))

console.log('going to listen on port', env.VPN_API_PORT)
apps = {}
ALLOWED_PORTS.forEach (port) ->
	app = Promise.promisifyAll(express())
	apps[port] = vpnApi

	app.use(vhost('localhost', vpnApi))
	app.use(vhost('vpn.resin.io', vpnApi))
	app.use(vhost('vpn.resinstaging.io', vpnApi))
	app.use(vhost('vpn.resindev.io', vpnApi))
	app.use(vhost('*.resindevice.io', reverseProxy))

	apps[port].listenAsync(port)
	.then ->
		console.log('listening on port', port)
		if port == 80
			console.log('reset all')
			clients.resetAll()
			# Now endpoints are established, release VPN hold.
			vpn.execCommand('hold release')
			.catch (e) ->
			       console.error('failed releasing hold', e, e.stack)



module.exports = apps[80]
