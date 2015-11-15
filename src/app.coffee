express = require 'express'
compression = require 'compression'
morgan = require 'morgan'
Promise = require 'bluebird'
Netmask = require('netmask').Netmask

{ OpenVPNSet } = require './libs/openvpn-nc'
deviceTunnel = require './device-tunnel'
clients = require './clients'

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

for k in envKeys when not process.env[k]?
	console.error("#{k} env variable is not set.")
	process.exit(1)

vpnSubnet = new Netmask(process.env.VPN_SUBNET)

# Basic sanity check.
if !vpnSubnet.contains(process.env.VPN_PRIVILEGED_SUBNET)
	fatal("Privileged IP subnet/24 #{process.env.VPN_PRIVILEGED_SUBNET} isn't on the VPN subnet #{process.env.VPN_SUBNET}")

managementPorts = [ process.env.VPN_MANAGEMENT_PORT, process.env.VPN_MANAGEMENT_NEW_PORT ]
vpn = new OpenVPNSet(managementPorts, process.env.VPN_HOST)

api = require('./api')(vpn, vpnSubnet)

deviceTunnel(process.env.VPN_CONNECT_PROXY_PORT)

app = Promise.promisifyAll(express())

app.use(morgan('combined', skip: (req) -> req.url is '/ping'))

app.get '/ping', (req, res) ->
	return res.send('OK')

app.use(compression())
app.use(api)

app.listenAsync(80)
.then ->
	console.log('listening on port', 80)
	clients.resetAll()
	# Now endpoints are established, release VPN hold.
	vpn.execCommand('hold release')
	.catch (e) ->
		console.error('failed releasing hold', e, e.stack)
