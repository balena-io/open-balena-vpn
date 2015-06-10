url = require 'url'
Promise = require 'bluebird'
PlatformApi = require('pinejs-client/request')
_ = require 'lodash'

platformEndpoint = url.resolve("https://#{process.env.RESIN_API_HOST}", '/ewa/')
resinApi = new PlatformApi(platformEndpoint)

DEVICE_WEB_PORTS = [ 80, 8080, 4200 ]
API_USERNAME = 'resin_api'

exports.getDeviceByVPNAddress = getDeviceByVPNAddress = (vpnAddress, apiKey) ->
	resinApi.get
		resource: 'device'
		options:
			select: [ 'id', 'is_web_accessible', 'vpn_address' ]
			filter:
				vpn_address: vpnAddress
		customOptions:
			apikey: apiKey
	.then (devices) ->
		return devices?[0]

exports.isAccessible = (vpnAddress, port, auth, vpnSubnet, apiKey) ->
	Promise.try ->
		return false unless vpnSubnet.contains(vpnAddress) 
		return true if auth?.username is API_USERNAME and auth?.password is apiKey
		return false unless _.contains(DEVICE_WEB_PORTS, parseInt(port))

		getDeviceByVPNAddress(vpnAddress, apiKey)
		.then (device) ->
			return device?.is_web_accessible
