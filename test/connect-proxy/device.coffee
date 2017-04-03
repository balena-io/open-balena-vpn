Promise = require 'bluebird'
chai = require 'chai'
nock = require 'nock'
chaiAsPromised = require 'chai-as-promised'

chai.use(chaiAsPromised)

expect = chai.expect

nock.disableNetConnect()

{ getDeviceByUUID, isAccessible } = require '../../src/connect-proxy/device'

beforeEach ->
	@mockDevice =
		id: 1234
		uuid: 'deadbeef'
		is_web_accessible: false
		is_connected_to_vpn: false
		__metadata:
			uri: '/resin/device(1234)'
			type: ''

describe 'getDeviceByUUID()', ->
	beforeEach ->
		nock("https://#{process.env.RESIN_API_HOST}:443")
		.get('/v2/device')
		.query(
			$select: 'id,uuid,is_web_accessible,is_connected_to_vpn'
			$filter: "uuid eq 'deadbeef'"
			apikey: 'test-api-key'
		)
		.reply(200, d: [ @mockDevice ])

	afterEach ->
		nock.cleanAll()

	it 'should return a promise', ->
		device = getDeviceByUUID('deadbeef', 'test-api-key')
		expect(device).to.be.an.instanceOf(Promise)

	it 'should resolve to the device requested', ->
		device = getDeviceByUUID('deadbeef', 'test-api-key')
		expect(device).to.eventually.deep.equal(@mockDevice)

describe 'isAccessible()', ->
	it 'should allow access for the api on port 80', ->
		auth =
			username: 'resin_api'
			password: process.env.VPN_SERVICE_API_KEY

		access = isAccessible(@mockDevice, 80, auth)
		expect(access).to.be.true

	it 'should allow access for the api on port 22', ->
		auth =
			username: 'resin_api'
			password: process.env.VPN_SERVICE_API_KEY

		access = isAccessible(@mockDevice, 22, auth)
		expect(access).to.be.true

	it 'should allow access for the api on port 22222', ->
		auth =
			username: 'resin_api'
			password: process.env.VPN_SERVICE_API_KEY

		access = isAccessible(@mockDevice, 22222, auth)
		expect(access).to.be.true

	it 'should disallow access when device is inaccessible', ->
		@mockDevice.is_web_accessible = false
		access = isAccessible(@mockDevice, 80, null)
		expect(access).to.be.false

	it 'should allow access for the proxy on port 22222', ->
		auth =
			username: 'resin_proxy'
			password: process.env.PROXY_SERVICE_API_KEY

		access = isAccessible(@mockDevice, 22222, auth)
		expect(access).to.be.true

	it 'should disallow unauthorized access on port 22222', ->
		@mockDevice.is_web_accessible = true
		access = isAccessible(@mockDevice, 22222, null)
		expect(access).to.be.false

	it 'should disallow access when port is not allowed', ->
		@mockDevice.is_web_accessible = true
		access = isAccessible(@mockDevice, 22, null)
		expect(access).to.be.false

	it 'should allow access on port 80', ->
		@mockDevice.is_web_accessible = true
		access = isAccessible(@mockDevice, 80, null)
		expect(access).to.be.true

	it 'should allow access on port 8080', ->
		@mockDevice.is_web_accessible = true
		access = isAccessible(@mockDevice, 8080, null)
		expect(access).to.be.true

# exports.isAccessible = (device, port, auth) ->
# 	isResinApi = auth?.username is API_USERNAME and auth?.password is API_KEY
# 	isWebPort = _.contains(DEVICE_WEB_PORTS, parseInt(port))
# 	return isResinApi or (device.is_web_accessible and isWebPort)
