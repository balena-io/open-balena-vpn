url = require 'url'
Promise = require 'bluebird'
PlatformApi = require('pinejs-client/request')
_ = require 'lodash'

platformEndpoint = url.resolve("https://#{process.env.RESIN_API_HOST}", '/ewa/')
resinApi = new PlatformApi(platformEndpoint)

DEVICE_WEB_PORTS = [ 80, 8080, 4200 ]
API_USERNAME = 'resin_api'

exports.getDeviceUUID = getDeviceByUUID = (uuid, apiKey) ->
	resinApi.get
		resource: 'device'
		options:
			select: [ 'id', 'uuid', 'is_web_accessible', 'vpn_address' ]
			filter:
				uuid: uuid
		customOptions:
			apikey: apiKey
	.get(0)

exports.isAccessible = Promise.method (uuid, port, auth, apiKey) ->
	return true if auth?.username is API_USERNAME and auth?.password is apiKey
	return false unless _.contains(DEVICE_WEB_PORTS, parseInt(port))

	getDeviceByUUID(uuid, apiKey).get('is_web_accessible')

exports.getVPNAddress = (uuid, apiKey) ->
	getDeviceByUUID(uuid, apiKey).get('vpn_address')
