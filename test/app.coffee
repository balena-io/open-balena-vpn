request = require 'supertest'
{ expect } = require('chai')
Promise = require 'bluebird'
_ = require 'lodash'

{ createVPNClient } = require './test-lib/vpnclient'
{ requestMock } = require './test-lib/requestmock'

app = require '../src/app'
beforeEach ->
	requests = []
	@requests = requests

# NOTE:
# 	ca.resindev.io or process.env.CA_ENDPOINT must be running for tests to work.
#
#   The before and after hooks in most tests require that openvpn hooks work,
#   which means that if openvpn hooks don't work, they will break the 
#   before and after scripts of the other tests as well.

describe '/api/v1/clients/', ->
	describe 'When no clients are connected', ->
		it 'should return empty client list', (done) ->
			request(app).get('/api/v1/clients/').expect(200, '{}', done)

	describe 'When clients are connected', ->
		@timeout(10000)

		before (done) ->
			requestMock.enable "#{process.env.API_ENDPOINT}/services/vpn/client-connect", (opts, cb) =>
				cb(null, statusCode: 200, 'OK')

			Promise.all( [
				createVPNClient(),
				createVPNClient()
			] )
			.spread (client1, client2) =>
				@client1 = client1
				@client2 = client2
				done()

		after (done) ->
			requestMock.enable "#{process.env.API_ENDPOINT}/services/vpn/client-disconnect", (opts, cb) =>
				disconnected += 1
				cb(null, statusCode: 200, 'OK')
				if disconnected == 2
					requestMock.disable()
					done()
			disconnected = 0
			@client1.disconnect()
			@client2.disconnect()

		it 'should return the list of clients', (done) ->
			request(app).get('/api/v1/clients/')
			.expect(200)
			.expect (res) =>
				body = res.body
				expect(body).to.have.property(@client1.uuid)
				expect(body).to.have.property(@client2.uuid)
				expect(body[@client1.uuid]).to.have.property('common_name').that.equals(@client1.uuid)
				expect(body[@client1.uuid]).to.have.property('real_address').that.match(/^127\.0\.0\.1:[0-9]+$/)
				expect(body[@client1.uuid]).to.have.property('virtual_address').that.match(/^10\.1\.0\.[0-9]+$/)
				expect(body[@client1.uuid]).to.have.property('connected_since')
				expect(body[@client1.uuid]).to.have.property('connected_since_t')
				expect(body[@client2.uuid]).to.have.property('common_name').that.equals(@client2.uuid)
				expect(body[@client2.uuid]).to.have.property('real_address').that.match(/^127\.0\.0\.1:[0-9]+$/)
				expect(body[@client2.uuid]).to.have.property('virtual_address').that.match(/^10\.1\.0\.[0-9]+$/)
				expect(body[@client2.uuid]).to.have.property('connected_since')
				expect(body[@client2.uuid]).to.have.property('connected_since_t')
				return false
			.end(done)

describe 'OpenVPN event hooks', ->
	@timeout(10000)

	describe 'when a client connects and then disconnects', ->
		before (done) ->
			@requests = []
			requestMock.enable "#{process.env.API_ENDPOINT}/services/vpn/client-connect", (opts, cb) =>
				@requests.push(_.clone(opts))
				cb(null, statusCode: 200, 'OK')
			requestMock.enable "#{process.env.API_ENDPOINT}/services/vpn/client-disconnect", (opts, cb) =>
				@requests.push(_.clone(opts))
				cb(null, statusCode: 200, 'OK')

			createVPNClient()
			.then (client) =>
				@client1 = client
				@client1.disconnect()
			.delay(1000)
			.then ->
				done()

		after ->
			requestMock.disable()

		it 'should first send a request to connect hook', ->
			expect(@requests.length).to.be.above(0)
			expect(@requests[0]).to.have.property('method').that.equals('post')
			expect(@requests[0]).to.have.property('url').that.match(/services\/vpn\/client-connect/)
			expect(@requests[0]).to.have.deep.property('form.common_name').that.equals(@client1.uuid)
			expect(@requests[0]).to.have.deep.property('form.virtual_address').that.match(/^10.1.0.[0-9]+$/)
			expect(@requests[0]).to.have.deep.property('form.real_address').that.equals('127.0.0.1')

		it 'and then a request to disconnect hook', ->
			expect(@requests.length).to.be.equal(2)
			expect(@requests[1]).to.have.property('method').that.equals('post')
			expect(@requests[1]).to.have.property('url').that.match(/services\/vpn\/client-disconnect/)
			expect(@requests[1]).to.have.deep.property('form.common_name').that.equals(@client1.uuid)
			expect(@requests[1]).to.have.deep.property('form.virtual_address').that.match(/^10.1.0.[0-9]+$/)
			expect(@requests[1]).to.have.deep.property('form.real_address').that.equals('127.0.0.1')

	describe 'when a client connects and then disconnects while the service is down', ->
		before (done) ->
			serviceIsDown = true
			@requests = []
			@successfulRequests = []
			requestMock.enable "#{process.env.API_ENDPOINT}/services/vpn/client-connect", (opts, cb) =>
				if serviceIsDown
					cb(null, statusCode: 500, 'ERROR')
				else
					cb(null, statusCode: 200, 'OK')
				opts.succeeded = not serviceIsDown
				@requests.push(_.clone(opts))
			requestMock.enable "#{process.env.API_ENDPOINT}/services/vpn/client-disconnect", (opts, cb) =>
				if serviceIsDown
					cb(null, statusCode: 500, 'ERROR')
				else
					cb(null, statusCode: 200, 'OK')
				opts.succeeded = not serviceIsDown
				@requests.push(_.clone(opts))

			createVPNClient()
			.then (client) =>
				@client1 = client
				serviceIsDown = false
				@client1.disconnect()
			.then ->
				# give it time to send all the requests
				setTimeout done, 1000
		after ->
			requestMock.disable()

		it 'should retry client-connect hook until it succeeds', ->
			retries = 0
			retries++ while @requests[retries] and not @requests[retries].succeeded and @requests[retries].url.match(/services\/vpn\/client-connect/)

			expect(retries).to.be.at.least(1)
			expect(retries).to.be.equal(@requests.length - 2)
			expect(@requests[retries]).to.have.property('url').that.match(/services\/vpn\/client-connect/)
			expect(@requests[retries]).to.have.property('method').that.equals('post')
			expect(@requests[retries+1]).to.have.property('url').that.match(/services\/vpn\/client-disconnect/)
			expect(@requests[retries+1]).to.have.property('method').that.equals('post')
