supertest = require 'supertest'
chai = require 'chai'
chai.use(require('chai-as-promised'))
{ expect } = chai
Promise = require 'bluebird'
_ = require 'lodash'
http = require 'http'
requestAsync = Promise.promisify(require('request'))
hostile = Promise.promisifyAll(require('hostile'))

{ createVPNClient } = require './test-lib/vpnclient'
{ requestMock } = require './test-lib/requestmock'

resetRequested = false
requestMock.enable 'https://api.resindev.io/services/vpn/reset-all', (args, cb) ->
	resetRequested = true
	cb(null, statusCode: 200, 'OK')

require '../src/app'

describe 'init', ->
	@timeout(10000)
	it 'should send a reset-all', ->
		Promise.delay(1000)
		.then ->
			expect(resetRequested).to.be.true

describe '/api/v1/clients/', ->
	@timeout(100000)
	before ->
		requestMock.enable 'https://api.resindev.io/services/vpn/auth/user1', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		requestMock.enable 'https://api.resindev.io/services/vpn/client-connect', (args, cb) ->
			cb(null, statusCode: 200, 'OK')
		
		requestMock.enable 'https://api.resindev.io/services/vpn/client-disconnect', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

	describe 'When no clients are connected', ->
		it 'should return empty client list', (done) ->
			Promise.delay(2000).then ->
				supertest('http://localhost').get('/api/v1/clients/').expect(200, '[]', done)

	describe 'When a client connects and disconnects', ->
		it 'should send the correct data', (done) ->
			createVPNClient("user1", "pass")
			.then (client) ->
				Promise.fromNode (cb) ->
					supertest('http://localhost').get('/api/v1/clients/')
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
					return client.disconnect()
			.then ->
				Promise.fromNode (cb) ->
					supertest('http://localhost').get('/api/v1/clients/').expect(200, '[]', cb)
			.nodeify(done)

eventsClient = null
describe 'VPN Events', ->
	@timeout(100000)
	before ->
		requestMock.enable 'https://api.resindev.io/services/vpn/auth/user2', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

	it 'should send a client-connect event', (done) =>
		connectEvent = new Promise (resolve, reject) ->
			requestMock.enable "https://api.resindev.io/services/vpn/client-connect", (opts, res) =>
				res(null, statusCode: 200, 'OK')

				data = opts.form
				if data.common_name != 'user2'
					return
				resolve(data)
		.then (data) ->
			expect(data).to.have.property('common_name').that.equals('user2')
			expect(data).to.have.property('real_address').that.match(/^127\.0\.0\.1$/)
			expect(data).to.have.property('virtual_address').that.match(/^10\.2\.0\.[0-9]+$/)

		spawn = createVPNClient("user2", "pass")
		.then (client) =>
			@client = client

		Promise.all([ connectEvent, spawn ]).nodeify(done)
	it 'should send a client-disconnect event', (done) =>
		new Promise (resolve, reject) ->
			requestMock.enable "https://api.resindev.io/services/vpn/client-disconnect", (opts, res) =>
				res(null, statusCode: 200, 'OK')

				data = opts.form
				if data.common_name != 'user2'
					return
				resolve(data)
		.then (data) ->
			expect(data).to.have.property('common_name').that.equals('user2')
			expect(data).to.have.property('real_address').that.match(/^127\.0\.0\.1$/)
			expect(data).to.have.property('virtual_address').that.match(/^10\.2\.0\.[0-9]+$/)
		.nodeify(done)

		@client.disconnect()

describe 'reverse proxy', ->
	@timeout(100000)
	before (done) ->
		requestMock.enable 'https://api.resindev.io/services/vpn/auth/user6', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		requestMock.enable 'https://api.resindev.io/services/vpn/client-connect', (args, cb) ->
			cb(null, statusCode: 200, 'OK')
		
		requestMock.enable 'https://api.resindev.io/services/vpn/client-disconnect', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		hostile.setAsync('127.0.0.1', 'deadbeef.devices.resindev.io')
		.nodeify(done)
	

	describe 'web accessible device', ->
		before ->
			requestMock.enable 'https://api.resindev.io/ewa/device', (args, cb) ->
				cb(null, { statusCode: 200 }, { d: [ { uuid: "deadbeef", is_web_accessible: 1, vpn_address: 'localhost', is_online: 1 } ] })

		it 'should allow port 4200 without authentication', (done) ->
			server = http.createServer (req, res) ->
				res.writeHead(200, 'Content-type': 'text/plain')
				res.end('hello from 4200')

			Promise.fromNode (cb) ->
				server.listen(4200, cb)
			.then ->
				createVPNClient("user6", "pass")
			.then (client) ->
				requestAsync({ url: "http://deadbeef.devices.resindev.io:80/test" })
				.spread (response, data) ->
					expect(response).to.have.property('statusCode').that.equals(200)
					expect(data).to.equal('hello from 4200')
				.finally ->
					client.disconnect()
			.finally ->
				Promise.fromNode (cb) ->
					server.close(cb)
			.nodeify(done)
	describe 'Pretty error pages when', ->
		it 'does not exist', (done) ->
			requestMock.enable 'https://api.resindev.io/ewa/device', (args, cb) ->
				cb(null, { statusCode: 200 }, { d: [] })

			requestAsync({ url: "http://deadbeef.devices.resindev.io:80/test" })
			.spread (response, data) ->
				expect(response).to.have.property('statusCode').that.equals(404)
				expect(data).to.match(/<title>Resin.io Device Public URLs<\/title>[\s\S]*Device Not Found/)
			.nodeify(done)
		it 'is not web accessible', (done) ->
			requestMock.enable 'https://api.resindev.io/ewa/device', (args, cb) ->
				cb(null, { statusCode: 200 }, { d: [ { uuid: "deadbeef", is_web_accessible: 0, vpn_address: 'localhost', is_online: 1 } ] })

			requestAsync({ url: "http://deadbeef.devices.resindev.io:80/test" })
			.spread (response, data) ->
				expect(response).to.have.property('statusCode').that.equals(403)
				expect(data).to.match(/<title>Resin.io Device Public URLs<\/title>[\s\S]*Device Public Access Disabled/)
			.nodeify(done)
		it 'is offline', (done) ->
			requestMock.enable 'https://api.resindev.io/ewa/device', (args, cb) ->
				cb(null, { statusCode: 200 }, { d: [ { uuid: "deadbeef", is_web_accessible: 1, vpn_address: 'localhost', is_online: 0 } ] })

			requestAsync({ url: "http://deadbeef.devices.resindev.io:80/test" })
			.spread (response, data) ->
				expect(response).to.have.property('statusCode').that.equals(503)
				expect(data).to.match(/<title>Resin.io Device Public URLs<\/title>[\s\S]*Device Not Accessible/)
			.nodeify(done)

describe 'VPN proxy', ->
	@timeout(100000)
	before ->
		requestMock.enable 'https://api.resindev.io/services/vpn/auth/user3', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		requestMock.enable 'https://api.resindev.io/services/vpn/auth/user4', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		requestMock.enable 'https://api.resindev.io/services/vpn/auth/user5', (args, cb) ->
			cb(null, statusCode: 200, 'OK')

		requestMock.enable 'https://api.resindev.io/services/vpn/client-connect', (args, cb) ->
			cb(null, statusCode: 200, 'OK')
		
		requestMock.enable 'https://api.resindev.io/services/vpn/client-disconnect', (args, cb) ->
			cb(null, statusCode: 200, 'OK')
	

	describe 'web accessible device', ->
		before ->
			requestMock.enable 'https://api.resindev.io/ewa/device', (args, cb) ->
				cb(null, { statusCode: 200 }, { d: [ { uuid: "deadbeef", is_web_accessible: 1, vpn_address: 'localhost', is_online: 1 } ] })

		it 'should allow port 4200 without authentication', (done) ->
			server = http.createServer (req, res) ->
				res.writeHead(200, 'Content-type': 'text/plain')
				res.end('hello from 4200')

			Promise.fromNode (cb) ->
				server.listen(4200, cb)
			.then ->
				createVPNClient("user3", "pass")
			.then (client) ->
				requestAsync({ url: "http://deadbeef.resin:4200/test", proxy: "http://localhost:3128", tunnel: true })
				.spread (response, data) ->
					expect(response).to.have.property('statusCode').that.equals(200)
					expect(data).to.equal('hello from 4200')
				.finally ->
					client.disconnect()
			.finally ->
				Promise.fromNode (cb) ->
					server.close(cb)
			.nodeify(done)

	describe 'not web accessible device', ->
		before ->
			requestMock.enable 'https://api.resindev.io/ewa/device', (args, cb) ->
				cb(null, { statusCode: 200 }, { d: [ { uuid: 'deadbeef', is_web_accessible: 0, vpn_address: 'localhost', is_online: 1 } ] })

		it 'should not allow port 4200 without authentication', (done) ->
			server = http.createServer (req, res) ->
				res.writeHead(200, 'Content-type': 'text/plain')
				res.end('hello from 4200')

			Promise.fromNode (cb) ->
				server.listen(4200, cb)
			.then ->
				createVPNClient("user4", "pass")
			.then (client) ->
				connection = requestAsync({ url: "http://deadbeef.resin:4200/test", proxy: "http://localhost:3128", tunnel: true })
				.finally ->
					client.disconnect()
				expect(connection).to.be.rejected
			.finally ->
				Promise.fromNode (cb) ->
					server.close(cb)
			.nodeify(done)

		it 'should allow port 4200 with authentication', (done) ->
			server = http.createServer (req, res) ->
				res.writeHead(200, 'Content-type': 'text/plain')
				res.end('hello from 4200')

			Promise.fromNode (cb) ->
				server.listen(4200, cb)
			.then ->
				createVPNClient("user5", "pass")
			.then (client) ->
				requestAsync({ url: "http://deadbeef.resin:4200/test", proxy: "http://resin_api:test_api_key@localhost:3128", tunnel: true })
				.spread (response, data) ->
					expect(response).to.have.property('statusCode').that.equals(200)
					expect(data).to.equal('hello from 4200')
				.finally ->
					client.disconnect()
			.finally ->
				Promise.fromNode (cb) ->
					server.close(cb)
			.nodeify(done)
