supertest = require 'supertest'
chai = require 'chai'
chai.use(require('chai-as-promised'))
{ expect } = chai
Promise = require 'bluebird'
http = require 'http'
requestAsync = Promise.promisify(require('request'), multiArgs: true)
path = require 'path'
vpnClient = require 'openvpn-client'
{ createJwt } = require '@resin/resin-jwt'

vpnHost = process.env.VPN_HOST ? '127.0.0.1'
vpnPort = process.env.VPN_PORT ? '443'
caCertPath = process.env.CA_CERT_PATH ? path.resolve(__dirname, 'data/ca.crt')

vpnClient.defaultOpts = [
	'--client',
	'--remote', vpnHost, vpnPort,
	'--ca', caCertPath,
	'--dev', 'tun',
	'--proto', 'tcp-client',
	'--comp-lzo',
	'--verb', '3'
]

requestMock = require('requestmock')
mockery = require 'mockery'
mockery.enable(warnOnUnregistered: false)
mockery.registerMock('request', requestMock)

resetRequested = false
requestMock.register 'post', 'https://api.resindev.io/services/vpn/reset-all', (args, cb) ->
	resetRequested = true
	cb(null, statusCode: 200, 'OK')

require '../src/app'
require('../src/connect-proxy')(process.env.VPN_CONNECT_PROXY_PORT)

describe 'init', ->
	@timeout(10000)
	it 'should send a reset-all', ->
		Promise.delay(1000)
		.then ->
			expect(resetRequested).to.be.true

describe '/api/v1/clients/', ->
	@timeout(100000)
	before ->
		requestMock.register 'get', 'https://api.resindev.io/services/vpn/auth/user1', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		requestMock.register 'post', 'https://api.resindev.io/services/vpn/client-connect', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		requestMock.register 'post', 'https://api.resindev.io/services/vpn/client-disconnect', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

	describe 'Without a web token', ->
		it 'should respond with 401', (done) ->
			supertest('http://localhost')
			.get('/api/v1/clients/')
			.expect(401, done)

	describe 'When no clients are connected', ->
		it 'should return empty client list', (done) ->
			supertest('http://localhost')
			.get('/api/v1/clients/')
			.set('Authorization', 'Bearer ' + createJwt({ service: 'api' }))
			.expect(200, '[]', done)

	describe 'When a client connects and disconnects', ->
		it 'should send the correct data', (done) ->
			Promise.using vpnClient.connect({ user: 'user1', pass: 'pass' }), ->
				Promise.fromNode (cb) ->
					supertest('http://localhost')
					.get('/api/v1/clients/')
					.set('Authorization', 'Bearer ' + createJwt({ service: 'api' }))
					.expect(200)
					.expect (res) ->
						clients = res.body
						expect(clients).to.be.instanceof(Array)
						expect(clients[0]).to.have.property('common_name').that.equals('user1')
						expect(clients[0]).to.have.property('real_address').that.match(/^127\.0\.0\.1:[0-9]+$/)
						expect(clients[0]).to.have.property('virtual_address').that.match(/^10\.2\.0\.[0-9]+$/)
						expect(clients[0]).to.have.property('connected_since')
						expect(clients[0]).to.have.property('connected_since_t')
						return false
					.end(cb)
			.then ->
				Promise.fromNode (cb) ->
					supertest('http://localhost')
					.get('/api/v1/clients/')
					.set('Authorization', 'Bearer ' + createJwt({ service: 'api' }))
					.expect(200, '[]', cb)
			.nodeify(done)

describe 'VPN Events', ->
	@timeout(100000)
	before ->
		requestMock.register 'get', 'https://api.resindev.io/services/vpn/auth/user2', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

	it 'should send a client-connect event', (done) =>
		connectEvent = new Promise (resolve, reject) ->
			requestMock.register 'post', 'https://api.resindev.io/services/vpn/client-connect', (opts, res) ->
				res(null, statusCode: 200, 'OK')

				data = opts.form
				if data.common_name != 'user2'
					return
				resolve(data)
		.then (data) ->
			expect(data).to.have.property('common_name').that.equals('user2')
			expect(data).to.not.have.property('real_address')
			expect(data).to.have.property('virtual_address').that.match(/^10\.2\.0\.[0-9]+$/)

		@client = vpnClient.create()
		@client.authenticate('user2', 'pass')

		Promise.all([ connectEvent, @client.connect() ]).nodeify(done)
	it 'should send a client-disconnect event', (done) =>
		new Promise (resolve, reject) ->
			requestMock.register 'post', 'https://api.resindev.io/services/vpn/client-disconnect', (opts, res) ->
				res(null, statusCode: 200, 'OK')

				data = opts.form
				if data.common_name != 'user2'
					return
				resolve(data)
		.then (data) ->
			expect(data).to.have.property('common_name').that.equals('user2')
			expect(data).to.not.have.property('real_address')
			expect(data).to.not.have.property('virtual_address')
		.nodeify(done)

		@client.disconnect()

describe 'VPN proxy', ->
	@timeout(100000)
	before ->
		requestMock.register 'get', 'https://api.resindev.io/services/vpn/auth/user3', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		requestMock.register 'get', 'https://api.resindev.io/services/vpn/auth/user4', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		requestMock.register 'get', 'https://api.resindev.io/services/vpn/auth/user5', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		requestMock.register 'post', 'https://api.resindev.io/services/vpn/client-connect', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		requestMock.register 'post', 'https://api.resindev.io/services/vpn/client-disconnect', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

	describe 'web accessible device', ->
		before ->
			requestMock.register 'get', 'https://api.resindev.io/ewa/device', (args, cb) ->
				cb(null, { statusCode: 200 }, d: [
					uuid: 'deadbeef'
					is_web_accessible: 1
					is_online: 1
				])

		it 'should allow port 8080 without authentication', (done) ->
			server = http.createServer (req, res) ->
				res.writeHead(200, 'Content-type': 'text/plain')
				res.end('hello from 8080')

			Promise.using vpnClient.connect({ user: 'user3', pass: 'pass' }), ->
				Promise.fromNode (cb) ->
					server.listen(8080, cb)
				.then ->
					requestAsync({ url: 'http://deadbeef.resin:8080/test', proxy: 'http://localhost:3128', tunnel: true })
					.spread (response, data) ->
						expect(response).to.have.property('statusCode').that.equals(200)
						expect(data).to.equal('hello from 8080')
				.finally ->
					Promise.fromNode (cb) ->
						server.close(cb)
			.nodeify(done)

	describe 'not web accessible device', ->
		before ->
			requestMock.register 'get', 'https://api.resindev.io/ewa/device', (args, cb) ->
				cb(null, { statusCode: 200 }, d: [ uuid: 'deadbeef', is_web_accessible: 0, is_online: 1 ])

		it 'should not allow port 8080 without authentication', (done) ->
			server = http.createServer (req, res) ->
				res.writeHead(200, 'Content-type': 'text/plain')
				res.end('hello from 8080')

			Promise.using vpnClient.connect({ user: 'user4', pass: 'pass' }), ->
				Promise.fromNode (cb) ->
					server.listen(8080, cb)
				.then ->
					connection = requestAsync({ url: 'http://deadbeef.resin:8080/test', proxy: 'http://localhost:3128', tunnel: true })
					expect(connection).to.be.rejected
				.finally ->
					Promise.fromNode (cb) ->
						server.close(cb)
			.nodeify(done)

		it 'should allow port 8080 with authentication', (done) ->
			server = http.createServer (req, res) ->
				res.writeHead(200, 'Content-type': 'text/plain')
				res.end('hello from 8080')

			Promise.using vpnClient.connect({ user: 'user5', pass: 'pass' }), ->
				Promise.fromNode (cb) ->
					server.listen(8080, cb)
				.then ->
					requestOpts =
						url: 'http://deadbeef.resin:8080/test'
						proxy: 'http://resin_api:test_api_key@localhost:3128'
						tunnel: true
					requestAsync(requestOpts)
					.spread (response, data) ->
						expect(response).to.have.property('statusCode').that.equals(200)
						expect(data).to.equal('hello from 8080')
				.finally ->
					Promise.fromNode (cb) ->
						server.close(cb)
			.nodeify(done)
