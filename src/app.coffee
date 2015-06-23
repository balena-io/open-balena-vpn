express = require 'express'
compression = require 'compression'
morgan = require 'morgan'
Promise = require 'bluebird'
Netmask = require('netmask').Netmask

{ OpenVPNSet } = require './libs/openvpn-nc'
deviceTunnel = require './device-tunnel'
reverseProxy = require './reverse-proxy'
clients = require './clients'

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

vpnSubnet = new Netmask(process.env.VPN_SUBNET)

# Basic sanity check.
if !vpnSubnet.contains(process.env.VPN_PRIVILEGED_SUBNET)
	fatal("Privileged IP subnet/24 #{process.env.VPN_PRIVILEGED_SUBNET} isn't on the VPN subnet #{process.env.VPN_SUBNET}")

managementPorts = [ process.env.VPN_MANAGEMENT_PORT, process.env.VPN_MANAGEMENT_NEW_PORT ]
vpn = new OpenVPNSet(managementPorts, process.env.VPN_HOST)

api = require('./api')(vpn, vpnSubnet)

deviceTunnel(env.VPN_CONNECT_PROXY_PORT)

ALLOWED_PORTS.forEach (port) ->
	app = Promise.promisifyAll(express())

	app.set('views', 'src/views')
	app.set('view engine', 'jade')

	app.use(morgan('combined', skip: (req) -> req.url is '/ping'))

	app.use(compression())
	app.use (req, res, next) ->
		req.port = port
		next()
	app.use(reverseProxy)

	app.use(api)

	app.listenAsync(port)
	.then ->
		console.log('listening on port', port)
		if port == 80
			clients.resetAll()
			# Now endpoints are established, release VPN hold.
			vpn.execCommand('hold release')
			.catch (e) ->
			       console.error('failed releasing hold', e, e.stack)
