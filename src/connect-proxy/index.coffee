device = require './device'
Promise = require 'bluebird'
{ createTunnel, basicAuth } = require 'node-tunnel'
logger = require 'winston'
TypedError = require 'typed-error'

class HandledTunnelingError extends TypedError

tunnelToDevice = (req, cltSocket, head, next) ->
	Promise.try ->
		[ uuid, port ] = req.url.match(/^([a-fA-F0-9]+).resin(?::([0-9]+))?$/)[1..]
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
			if not data.is_online
				cltSocket.end('HTTP/1.0 503 Service Unavailable\r\n\r\n')
				throw new HandledTunnelingError('Device not available: ' + uuid)
			req.url = "#{uuid}.vpn:#{port}"
	.then ->
		next()
	.catch HandledTunnelingError, (err) ->
		logger.error('tunneling error ', err?.message ? err)
	.catch (err) ->
		logger.error('tunnel catch', err, err.stack)
		cltSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n')

module.exports = (port) ->
	tunnel = createTunnel()
	tunnel.use(basicAuth)
	tunnel.use(tunnelToDevice)
	tunnel.listen port, ->
		logger.info('tunnel listening on port', port)
	tunnel.on 'error', (err) ->
		logger.error('failed to connect to device:', err.message ? err, err.stack)
	tunnel.on 'connect', (hostname, port) ->
		logger.info('tunnel opened to', hostname, port)
