url = require 'url'
Promise = require 'bluebird'
PlatformApi = require('pinejs-client/request')
_ = require 'lodash'

platformEndpoint = url.resolve("https://#{process.env.RESIN_API_HOST}", '/ewa/')
resinApi = new PlatformApi(platformEndpoint)

DEVICE_WEB_PORTS = [ 80, 8080 ]
API_USERNAME = 'resin_api'
API_KEY = process.env.VPN_SERVICE_API_KEY

DEVICE_SSH_PORT = 22222
PROXY_USERNAME = 'resin_proxy'
PROXY_KEY = process.env.PROXY_SERVICE_API_KEY

exports.getDeviceByUUID = getDeviceByUUID = (uuid, apiKey) ->
	resinApi.get
		resource: 'device'
		options:
			select: [ 'id', 'uuid', 'is_web_accessible', 'is_online' ]
			filter:
				uuid: uuid
		customOptions:
			apikey: apiKey
	.get(0)

# Given the device model, a port and credentials (an object with username and password)
# return true if the client is allowed to connect that port of the device.
exports.isAccessible = (device, port, auth) ->
	isResinApi = auth?.username is API_USERNAME and auth?.password is API_KEY
	isResinSSHProxy = auth?.username is PROXY_USERNAME and auth?.password is PROXY_KEY and parseInt(port) is DEVICE_SSH_PORT
	isWebPort = _.includes(DEVICE_WEB_PORTS, parseInt(port))
	return isResinApi or isResinSSHProxy or (device.is_web_accessible and isWebPort)
