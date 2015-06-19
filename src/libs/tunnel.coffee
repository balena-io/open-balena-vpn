http = require 'http'
net = require 'net'
url = require 'url'
Promise = require 'bluebird'
basicAuthParser = require 'basic-auth-parser'
MiddlewareHandler = require 'middleware-handler'
MiddlewareHandler.prototype = Promise.promisifyAll(MiddlewareHandler.prototype)

# Connect an http socket to another tcp server.
# Based on tunneling proxy code from https://nodejs.org/api/http.html
connectSocket = (cltSocket, hostname, port, head) ->
	srvSocket = net.connect port, hostname, ->
		cltSocket.write "HTTP/1.1 200 Connection Established\r\n\
				Proxy-agent: Resin-VPN\r\n\
				\r\n"
		srvSocket.write(head)
		srvSocket.pipe(cltSocket)
		cltSocket.pipe(srvSocket)
	new Promise (resolve, reject) ->
		srvSocket.on('error', reject)
		srvSocket.on('end', resolve)
	.finally (e) ->
		srvSocket.end()

# Create an http CONNECT tunneling proxy
# Expressjs-like middleware can be used to change destination (by modifying req.url)
# or for filtering requests (for example by terminating a socket early.)
exports.createTunnel = createTunnel = ->
	middleware = new MiddlewareHandler()

	server = http.createServer (req, res) ->
		res.writeHead(405, 'Content-Type': 'text/plain')
		res.end('Method not allowed')

	server.on 'connect', (req, cltSocket, head) ->
		middleware.handleAsync([ req, cltSocket, head ])
		.then ->
			srvUrl = url.parse("http://#{req.url}")
			connectSocket(cltSocket, srvUrl.hostname, srvUrl.port, head)
		.catch (err) ->
			console.error('http tunnel error', err)
			cltSocket.end()

	tunnel =
		use: middleware.use.bind(middleware)
		listen: server.listen.bind(server)

	return tunnel

# Proxy authorization middleware for http tunnel.
exports.basicAuth = basicAuth = (req, cltSocket, head, next) ->
	if req.headers['proxy-authorization']?
		req.auth = basicAuthParser(req.headers['proxy-authorization'])
	next()
