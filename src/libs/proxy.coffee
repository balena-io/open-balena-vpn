http = require 'http'
net = require 'net'
url = require 'url'
Promise = require 'bluebird'

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
		# connect to an origin server
		srvUrl = url.parse("http://#{req.url}")
		srvSocket = null

		hostFilter(srvUrl.hostname)
		.then (accessible) ->
			Promise.try ->
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
			console.error('proxy error', e, e.stack)
			srvSocket.end() if srvSocket?
			cltSocket.end()

	return proxy

module.exports = createProxy
