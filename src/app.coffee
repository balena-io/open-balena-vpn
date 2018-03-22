require 'ts-node/register'
_ = require('lodash')
cluster = require('cluster')
os = require('os')
forever = require('forever-monitor')
express = require 'express'
compression = require 'compression'
morgan = require 'morgan'
Promise = require 'bluebird'

service = require './service'
{ Raven } = require './errors'
{ VERSION } = require './utils'
{ Netmask } = require './utils/netmask'

envKeys = [
	'RESIN_API_HOST'
	'VPN_SERVICE_API_KEY'
	'VPN_HOST'
	'VPN_API_BASE_PORT'

	'VPN_BASE_SUBNET'
	'VPN_BASE_PORT'
	'VPN_BASE_MANAGEMENT_PORT'
	'VPN_INSTANCE_COUNT'
	'VPN_INSTANCE_SUBNET_BITMASK'
]

for k in envKeys when not process.env[k]?
	console.error("#{k} env variable is not set.")
	process.exit(1)

RESIN_VPN_GATEWAY = process.env.RESIN_VPN_GATEWAY

getInstanceSubnet = (instanceId) ->
	[ netBase, netMask ] = process.env.VPN_BASE_SUBNET.split('/')
	splitMask = process.env.VPN_INSTANCE_SUBNET_BITMASK
	net = new Netmask(netBase, netMask)
	return net.split(splitMask)[instanceId - 1]

VPN_BASE_PORT = parseInt(process.env.VPN_BASE_PORT)
VPN_BASE_MANAGEMENT_PORT = parseInt(process.env.VPN_BASE_MANAGEMENT_PORT)
VPN_API_BASE_PORT = parseInt(process.env.VPN_API_BASE_PORT)

nWorkers = parseInt(process.env.VPN_INSTANCE_COUNT)
if isNaN(nWorkers) or nWorkers == 0
	nWorkers = os.cpus().length

if cluster.isMaster
	console.log("resin-vpn@#{VERSION} master process started with pid #{process.pid}")
	if nWorkers > 1
		console.log("spawning #{nWorkers} workers")
		_.times nWorkers, (i) ->
			instanceId = i + 1
			restartWorker = (code, signal) ->
				if signal?
					console.error("worker-#{instanceId} killed with signal #{signal}")
				if code?
					console.error("worker-#{instanceId} exited with code #{code}")
				cluster.fork(VPN_INSTANCE_ID: instanceId).on('exit', restartWorker)
			restartWorker()

if cluster.isWorker or nWorkers == 1
	instanceId = parseInt(process.env.VPN_INSTANCE_ID) or 1
	console.log("resin-vpn@#{VERSION} worker-#{instanceId} process started with pid #{process.pid}")

	vpnPort = VPN_BASE_PORT + instanceId
	mgtPort = VPN_BASE_MANAGEMENT_PORT + instanceId
	apiPort = VPN_API_BASE_PORT + instanceId

	# prepare openvpn instance
	subnet = getInstanceSubnet(instanceId)
	gateway = RESIN_VPN_GATEWAY or subnet.first
	command = [
		'/usr/sbin/openvpn'
		'--status', "/run/openvpn/server-#{instanceId}.status", '10'
		'--cd', '/etc/openvpn'
		'--config', '/etc/openvpn/server.conf'
		'--dev', "tun#{instanceId}"
		'--port', vpnPort
		'--management', '127.0.0.1', mgtPort
		'--ifconfig', gateway, subnet.second
		'--ifconfig-pool', subnet.third, subnet.last
		'--route', subnet.base, subnet.mask
		'--push', "route #{gateway}"
		'--auth-user-pass-verify', "scripts/auth-resin.sh #{instanceId}", 'via-env'
		'--client-connect', "scripts/client-connect.sh #{instanceId}"
		'--client-disconnect', "scripts/client-disconnect.sh #{instanceId}"]
	openvpn = new forever.Monitor command,
		uid: "openvpn_#{instanceId}"
		env: process.env
		max: 10
		spinSleepTime: 1000
	.on('exit', -> process.exit(2))

	# create api instance
	api = require('./api')()
	app = Promise.promisifyAll(express())
	app.use(Raven.requestHandler())
	app.use(morgan('combined', skip: (req) -> req.url is '/ping'))
	app.get('/ping', (req, res) -> res.send('OK'))
	app.use(compression())
	app.use(api)
	app.use(Raven.errorHandler())

	# register as a service instance and start services
	service.register()
	.tap ->
		# start api service
		console.log("worker-#{instanceId} listening on port #{apiPort}")
		app.listenAsync(apiPort)
	.tap ->
		# start openvpn instance
		openvpn.start()
	.tap ->
		# update haproxy configuration
		haproxy = require('net').createConnection '/var/run/haproxy.sock', ->
			haproxy.on('error', -> process.exit(1))
			preamble = "set server vpn-cluster/vpn#{instanceId}"
			haproxy.write("#{preamble} addr 127.0.0.1 port #{vpnPort}\r\n#{preamble} state ready\r\n", -> haproxy.destroy())
	.tap(service.scheduleHeartbeat)
