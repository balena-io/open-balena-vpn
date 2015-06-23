Promise = require 'bluebird'
_ = require 'lodash'
httpProxy = require 'http-proxy'
proxy = Promise.promisifyAll(httpProxy.createProxyServer())

tunnelingAgent = require('tunnel').httpOverHttp( {
	proxy:
		host: 'localhost'
		port: 3128
} )

renderError = (res, statusCode, context = {}) ->
	res.status(statusCode).render(statusCode, context)

reverseProxy = (req, res, next) ->
	hostRegExp = new RegExp("^([a-f0-9]+)\\.#{_.escapeRegExp(process.env.DEVICE_URLS_BASE)}$")
	hostMatch = req.hostname.match(hostRegExp)
	if not hostMatch
		return next()

	# target port is same as port requested on proxy
	# DEVICE_WEB_PORT is used by tests to always redirect to a specific port
	port = process.env.DEVICE_WEB_PORT or req.port

	deviceUuid = hostMatch[1]

	proxy.webAsync(req, res, { target: "http://#{deviceUuid}.resin:#{port}", agent: tunnelingAgent })
	.catch (err) ->
		console.log("proxy error", err, err.stack)
		# "sutatus" is typo on node-tunnel project
		statusCode = err.message.match(/sutatusCode=([0-9]+)$/)?[1]
		# if the error was caused when connecting through the tunnel
		# use the status code to provide a nicer error page.
		if statusCode
			renderError(res, statusCode, { port, deviceUuid })
		else
			renderError(res, 500, { port, deviceUuid, error: err?.message or err })

module.exports = reverseProxy
