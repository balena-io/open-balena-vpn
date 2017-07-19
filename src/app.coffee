express = require 'express'
compression = require 'compression'
morgan = require 'morgan'
Promise = require 'bluebird'

{ OpenVPN } = require './libs/openvpn-nc'
service = require './service'

envKeys = [
	'RESIN_API_HOST'
	'VPN_SERVICE_API_KEY'
	'VPN_HOST'
	'VPN_MANAGEMENT_PORT'
	'VPN_API_PORT'
]

for k in envKeys when not process.env[k]?
	console.error("#{k} env variable is not set.")
	process.exit(1)

vpn = new OpenVPN(process.env.VPN_MANAGEMENT_PORT, process.env.VPN_HOST)

api = require('./api')(vpn)

app = Promise.promisifyAll(express())

app.use(morgan('combined', skip: (req) -> req.url is '/ping'))

app.get '/ping', (req, res) ->
	return res.send('OK')

app.use(compression())
app.use(api)

service.register()
.then ->
	app.listenAsync(80)
.then ->
	console.log('listening on port', 80)
	# Now endpoints are established, release VPN hold.
	vpn.execCommand('hold release')
	.catch (e) ->
		console.error('failed releasing hold', e, e.stack)
.then ->
	service.scheduleHeartbeat()
