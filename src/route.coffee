url = require 'url'
_ = require('lodash')

Promise = require 'bluebird'
httpProxy = require('http-proxy')

PlatformApi = require('pinejs-client/request')
platformEndpoint = url.resolve("https://#{process.env.RESIN_API_HOST}", '/ewa/')
resinApi = new PlatformApi(platformEndpoint)

apiUrl = process.env.RESIN_API_HOST
apiKey = process.env.DEVICE_URLS_SERVICE_API_KEY
deviceUrlsBase = process.env.DEVICE_URLS_BASE

proxy = Promise.promisifyAll(httpProxy.createProxyServer())

hostRegExp = new RegExp("^([a-f0-9]+)\\.#{_.escapeRegExp(deviceUrlsBase)}$")

getDeviceByUuid = (uuid) ->
	resinApi.get(
		resource: 'device'
		options:
			select: [ 'id', 'is_online', 'is_web_accessible', 'vpn_address' ]
			filter:
				uuid: uuid
		customOptions:
			apikey: apiKey
	).then (devices) ->
		return devices?[0]

module.exports = (req, res) ->
	deviceUuid = req.hostname.match(hostRegExp)?[1]
	port = req.port

	if not deviceUuid
		if req.path == '/ping' and req.method.toUpperCase() == 'GET'
			return res.send('OK')
		else
			return res.sendStatus(404)

	renderError = (code, view, extraContext) ->
		context = _.extend { deviceUuid, port }, extraContext
		res.status(code).render(view, context)

	getDeviceByUuid(deviceUuid)
	.then (result) ->
		return renderError(404, 'not-found') if not result?
		return renderError(403, 'not-enabled') if not result.is_web_accessible
		return renderError(502, 'not-accessible') if not result.is_online or not result.vpn_address

		proxyAddress = "http://#{result.vpn_address}:#{port}"
		proxy.webAsync(req, res, { target: proxyAddress })
	.catch (err) ->
		console.error(err)
		renderError(500, 'error', { error: err?.message or err })
