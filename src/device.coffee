url = require 'url'
Promise = require 'bluebird'
PlatformApi = require('pinejs-client-js/request')

platformEndpoint = url.resolve(process.env.RESIN_API_HOST, '/ewa/')
resinApi = new PlatformApi(platformEndpoint)

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

exports.isAccessible = (vpnAddress, vpnSubnet, apiKey) ->
	Promise.try ->
		return false unless vpnSubnet.contains(vpnAddress)

		getDeviceByVPNAddress(vpnAddress, apiKey)
	.then (device) ->
		return device?
