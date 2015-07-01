device = require './device'
Promise = require 'bluebird'
{ createTunnel, basicAuth } = require 'node-tunnel'

tunnelToDevice = (req, cltSocket, head, next) ->
	Promise.try ->
		[ uuid, port ] = req.url.match(/^([a-fA-F0-9]+).resin(?::([0-9]+))?$/)[1..]
		if not uuid?
			throw new Error('Invalid hostname: ' + hostname)
		if not port?
			port = 80

		device.getDeviceByUUID(uuid, process.env.VPN_SERVICE_API_KEY)
		.then (data) ->
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
	.then ->
		next()
	.catch (err) ->
		console.log('tunnel catch', err, err.stack)
		cltSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n')

module.exports = (port) ->
	tunnel = createTunnel()
	tunnel.use(basicAuth)
	tunnel.use(tunnelToDevice)
	tunnel.listen(port)
