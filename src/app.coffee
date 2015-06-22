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

{ OpenVPNSet } = require './libs/openvpn-nc'
clients = require './clients'
httpProxy = require 'http-proxy'
proxy = Promise.promisifyAll(httpProxy.createProxyServer())

tunnelingAgent = require('tunnel').httpOverHttp( {
	proxy:
		host: 'localhost'
		port: 3128
} )

ALLOWED_PORTS = [ 80, 8080 ]

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
	'DEVICE_URLS_BASE'
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
		console.log('tunnel', req.url)
		[ uuid, port ] = req.url.match(/^([a-fA-F0-9]+).resin(?::([0-9]+))?$/)[1..]
		if not uuid?
			throw new Error('Invalid hostname: ' + hostname)
		if not port?
			port = 80

		device.getDeviceByUUID(uuid, env.VPN_SERVICE_API_KEY)
		.then (data) ->
			console.log('device data', data)
			if not data?
				cltSocket.end('HTTP/1.1 404 Not Found\r\n\r\n')
				throw new Error('Device not found: ' + uuid)
			if not device.isAccessible(data, port, req.auth)
				cltSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
				throw new Error('Device not accessible: ' + uuid)
			if not data.vpn_address or not data.is_online
				cltSocket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n')
				throw new Error('Device not available: ' + uuid)
			req.url = data.vpn_address + ":" + port
			console.log('rewrite url', uuid, req.url)
	.then ->
		next()
	.catch (err) ->
		console.log('tunnel catch', err, err.stack)
		cltSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n')

tunnel.listen(env.VPN_CONNECT_PROXY_PORT)

renderError = (res, statusCode, context = {}) ->
	res.status(statusCode).render(statusCode, context)

notFromVpnClients = (req, res, next) ->
	if vpnSubnet.contains(req.ip) and !privileged.contains(req.ip)
		return res.sendStatus(401)

	next()

ALLOWED_PORTS.forEach (port) ->
	app = Promise.promisifyAll(express())

	app.set('views', 'src/views')
	app.set('view engine', 'jade')

	app.use(compression())

	app.use (req, res, next) ->
		req.port = port
		next()

	app.use(morgan('combined', skip: (req) -> req.url is '/ping'))

	app.use (req, res, next) ->
		hostRegExp = new RegExp("^([a-f0-9]+)\\.#{_.escapeRegExp(env.DEVICE_URLS_BASE)}$")
		hostMatch = req.hostname.match(hostRegExp)
		if not hostMatch
			return next()

		# target port is same as port requested on proxy
		# DEVICE_WEB_PORT is used by tests to always redirect to a specific port
		port = env.DEVICE_WEB_PORT or req.port
		deviceUuid = hostMatch[1]

		proxy.webAsync(req, res, { target: "http://#{deviceUuid}.resin:#{port}", agent: tunnelingAgent })
		.catch (err) ->
			# "sutatus" is typo on node-tunnel project
			statusCode = err.message.match(/sutatusCode=([0-9]+)$/)[1]
			# if the error was caused when connecting through the tunnel
			# use the status code to provide a nicer error page.
			if statusCode
				renderError(res, statusCode, { port, deviceUuid })
			else
				renderError(res, 500, { port, deviceUuid, error: err?.message or err })

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

	app.post '/api/v1/auth/', fromLocalHost, (req, res) ->
		if not req.body.username?
			return res.sendStatus(400)
		if not req.body.password?
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
			console.log('authentication failed', e)
			res.sendStatus(401)
		

	app.delete '/api/v1/clients/', fromLocalHost, (req, res) ->
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

	app.listenAsync(port)
	.then ->
		console.log('listening on port', port)
		if port == 80
			clients.resetAll()
			# Now endpoints are established, release VPN hold.
			vpn.execCommand('hold release')
			.catch (e) ->
			       console.error('failed releasing hold', e, e.stack)
