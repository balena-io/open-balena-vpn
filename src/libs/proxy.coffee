http = require 'http'
net = require 'net'
url = require 'url'
Promise = require 'bluebird'
basicAuthParser = require 'basic-auth-parser'

# Create an HTTP tunneling proxy
# Based on proxy code from https://nodejs.org/api/http.html
#
# hostFilter should return a resolved promise if tunneling
# to that hostname is allowed.
createProxy = (hostFilter) ->
	proxy = http.createServer (req, res) ->
		res.writeHead(405, 'Content-Type': 'text/plain')
		res.end('Method not allowed')

	proxy.on 'connect', (req, cltSocket, head) ->
		srvSocket = null
		Promise.try ->
			if req.headers['proxy-authorization']?
				auth = basicAuthParser(req.headers['proxy-authorization'])
			else
				auth = null

			# connect to an origin server
			srvUrl = url.parse("http://#{req.url}")

			hostFilter(srvUrl.hostname, srvUrl.port, auth)
			.then (accessible) ->
				return cltSocket.end("HTTP/1.1 502 Not Accessible\r\n\r\n") if not accessible
				srvSocket = net.connect srvUrl.port, srvUrl.hostname, ->
					cltSocket.write "HTTP/1.1 200 Connection Established\r\n\
							Proxy-agent: Resin-VPN\r\n\
							\r\n"
					srvSocket.write(head)
					srvSocket.pipe(cltSocket)
					cltSocket.pipe(srvSocket)
				new Promise (resolve, reject) ->
					srvSocket.on('error', reject)
					srvSocket.on('end', resolve)
		.catch (e) ->
			srvSocket?.end()
			cltSocket.end()

	return proxy

module.exports = createProxy
