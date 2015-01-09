request = require 'supertest'
{ expect } = require('chai')
Promise = require 'bluebird'
_ = require 'lodash'

{ createVPNClient } = require './test-lib/vpnclient'
{ requestMock } = require './test-lib/requestmock'

app = require '../src/app'

# NOTE:
# 	ca.resindev.io or process.env.CA_ENDPOINT must be running for tests to work.
#
#   The before and after hooks in most tests require that openvpn hooks work,
#   which means that if openvpn hooks don't work, they will break the 
#   before and after scripts of the other tests as well.

# After each tests the client uuids used are added here
# This way openvpn events from previous tests are ignored in next tests
ignoreClients = []

describe '/api/v1/clients/', ->
	describe 'When no clients are connected', ->
		it 'should return empty client list', (done) ->
			request(app).get('/api/v1/clients/').expect(200, '[]', done)

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
			.nodeify(done)

		after (done) ->
			Promise.all( [
				@client1.disconnect()
				@client2.disconnect()
			] )
			.then =>
				ignoreClients.push(@client1.uuid, @client2.uuid)
				requestMock.disable()
			.nodeify(done)

		it 'should return the list of clients', (done) ->
			request(app).get('/api/v1/clients/')
			.expect(200)
			.expect (res) =>
				body = res.body
				expect(body).to.be.instanceof(Array)
				# ensure client1 is first and client2 is second
				clients = _.sortBy(body, (c) => c.common_name != @client1.uuid)
				expect(clients[0]).to.have.property('common_name').that.equals(@client1.uuid)
				expect(clients[0]).to.have.property('real_address').that.match(/^127\.0\.0\.1:[0-9]+$/)
				expect(clients[0]).to.have.property('virtual_address').that.match(/^10\.1\.0\.[0-9]+$/)
				expect(clients[0]).to.have.property('connected_since')
				expect(clients[0]).to.have.property('connected_since_t')
				expect(clients[1]).to.have.property('common_name').that.equals(@client2.uuid)
				expect(clients[1]).to.have.property('real_address').that.match(/^127\.0\.0\.1:[0-9]+$/)
				expect(clients[1]).to.have.property('virtual_address').that.match(/^10\.1\.0\.[0-9]+$/)
				expect(clients[1]).to.have.property('connected_since')
				expect(clients[1]).to.have.property('connected_since_t')
				return false
			.end(done)

describe 'OpenVPN event hooks', ->
	@timeout(10000)

	describe 'when a client connects and then disconnects', ->
		before (done) ->
			@requests = []
	
			# listen to connect and disconnect events and start testing on first disconnect
			requestMock.enable "#{process.env.API_ENDPOINT}/services/vpn/client-connect", (opts, cb) =>
				if not (opts.form.common_name in ignoreClients)
					@requests.push(_.clone(opts))
				cb(null, statusCode: 200, 'OK')
			requestMock.enable "#{process.env.API_ENDPOINT}/services/vpn/client-disconnect", (opts, cb) =>
				if not (opts.form.common_name in ignoreClients)
					@requests.push(_.clone(opts))
					done()
				cb(null, statusCode: 200, 'OK')

			createVPNClient()
			.then (client) =>
				@client1 = client
				@client1.disconnect()

		after ->
			ignoreClients.push(@client1)	
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

			# listen to wait and disconnect requests and start testing on first disconnect
			requestMock.enable "#{process.env.API_ENDPOINT}/services/vpn/client-connect", (opts, cb) =>
				if serviceIsDown
					cb(null, statusCode: 500, 'ERROR')
				else
					cb(null, statusCode: 200, 'OK')
				opts.succeeded = not serviceIsDown
				if not (opts.form.common_name in ignoreClients)
					@requests.push(_.clone(opts))
			requestMock.enable "#{process.env.API_ENDPOINT}/services/vpn/client-disconnect", (opts, cb) =>
				if serviceIsDown
					cb(null, statusCode: 500, 'ERROR')
				else
					cb(null, statusCode: 200, 'OK')
				opts.succeeded = not serviceIsDown
				if not (opts.form.common_name in ignoreClients)
					@requests.push(_.clone(opts))
					done()

			createVPNClient()
			.then (client) =>
				@client1 = client
				serviceIsDown = false
				@client1.disconnect()

		after ->
			ignoreClients.push(@client1)
			requestMock.disable()

		it 'should retry client-connect hook until it succeeds', ->
			retries = _.size _.first @requests, (request) ->
				not request.succeeded and request.url.match(/services\/vpn\/client-connect/)

			expect(retries).to.be.at.least(1)
			expect(retries).to.be.equal(@requests.length - 2)
			expect(@requests[retries]).to.have.property('url').that.match(/services\/vpn\/client-connect/)
			expect(@requests[retries]).to.have.property('method').that.equals('post')
			expect(@requests[retries+1]).to.have.property('url').that.match(/services\/vpn\/client-disconnect/)
			expect(@requests[retries+1]).to.have.property('method').that.equals('post')
