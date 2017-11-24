device = require './device'
Promise = require 'bluebird'
{ createTunnel, basicAuth } = require 'node-tunnel'
logger = require 'winston'

{ captureException, Raven, HandledTunnelingError } = require '../errors'

tunnelToDevice = (req, cltSocket, head, next) ->
	Promise.try ->
		[ uuid, port ] = req.url.match(/^([a-fA-F0-9]+).resin(?::([0-9]+))?$/)[1..]
		Raven.setContext(user: uuid: uuid)
		logger.info('tunnel requested for', uuid, port)
		if not uuid?
			throw new Error('Invalid hostname: ' + req.url)
		if not port?
			port = 80

		device.getDeviceByUUID(uuid, process.env.VPN_SERVICE_API_KEY)
		.then (data) ->
			if not data?
				cltSocket.end('HTTP/1.0 404 Not Found\r\n\r\n')
				throw new HandledTunnelingError('Device not found: ' + uuid)
			if not device.isAccessible(data, port, req.auth)
				cltSocket.end('HTTP/1.0 407 Proxy Authorization Required\r\n\r\n')
				throw new HandledTunnelingError('Device not accessible: ' + uuid)
			if not data.is_connected_to_vpn
				cltSocket.end('HTTP/1.0 503 Service Unavailable\r\n\r\n')
				throw new HandledTunnelingError('Device not available: ' + uuid)
			req.url = "#{uuid}.vpn:#{port}"
	.then ->
		next()
	.catch HandledTunnelingError, (err) ->
		console.error('tunneling error', err?.message or err, err.stack)
	.catch (err) ->
		captureException(err, 'tunnel catch')
		cltSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n')

module.exports = (port) ->
	tunnel = createTunnel()
	tunnel.use(basicAuth)
	tunnel.use(tunnelToDevice)
	tunnel.listen port, ->
		logger.info('tunnel listening on port', port)
	tunnel.on 'error', (err) ->
		captureException(err, 'failed to connect to device')
	tunnel.on 'connect', (hostname, port) ->
		logger.info('tunnel opened to', hostname, port)
