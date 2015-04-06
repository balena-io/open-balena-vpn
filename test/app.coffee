request = require 'supertest'
{ expect } = require('chai')
Promise = require 'bluebird'
_ = require 'lodash'

{ createVPNClient } = require './test-lib/vpnclient'
{ requestMock } = require './test-lib/requestmock'

app = require '../src/app'

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
				request(app).get('/api/v1/clients/').expect(200, '[]', done)

	describe 'When a client connects and disconnects', ->
		it 'should send the correct data', (done) ->
			createVPNClient("user1", "pass")
			.then (client) ->
				Promise.fromNode (cb) ->
					request(app).get('/api/v1/clients/')
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
					request(app).get('/api/v1/clients/').expect(200, '[]', cb)
			.nodeify(done)

eventsClient = null
describe 'VPN Events', ->
	@timeout(10000)
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
