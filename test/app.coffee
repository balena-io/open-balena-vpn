mocha = require 'mocha'
request = require 'supertest'
expect = require('chai').expect
Promise = require 'bluebird'
_ = require 'lodash'

{ createVPNClient } = require './test-lib/vpnclient'
{ requestMock } = require './test-lib/requestmock'

app = require '../src/app'

beforeEach ->
	requests = []
	@requests = requests

describe '/api/v1/clients/', ->
	describe 'When no clients are connected', ->
		it 'should return empty client list', (done) ->
			request(app).get('/api/v1/clients/').expect(200, '{}', done)

	describe 'When clients are connected', ->
		@timeout(10000)

		before (done) ->
			Promise.all( [
				createVPNClient(),
				createVPNClient()
			] )
			.spread (client1, client2) =>
				@client1 = client1
				@client2 = client2
				done()

		after (done) ->
			Promise.all( [
				@client1.disconnect()
				@client2.disconnect()
			] ).delay(1000).then ->
				done()

		it 'should return the list of clients', (done) ->
			request(app).get('/api/v1/clients/')
			.expect(200)
			.expect (res) =>
				body = res.body
				expect(body).to.have.property(@client1.uuid)
				expect(body).to.have.property(@client2.uuid)
				expect(body[@client1.uuid]).to.have.property('common_name').that.equal(@client1.uuid)
				expect(body[@client1.uuid]).to.have.property('real_address').that.match(/^127\.0\.0\.1:[0-9]+$/)
				expect(body[@client1.uuid]).to.have.property('virtual_address').that.match(/^10\.1\.0\.[0-9]+$/)
				expect(body[@client1.uuid]).to.have.property('connected_since')
				expect(body[@client1.uuid]).to.have.property('connected_since_t')
				expect(body[@client2.uuid]).to.have.property('common_name').that.equal(@client2.uuid)
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
			.then ->
				done()
		after ->
			requestMock.disable()

		it 'should first send a request to connect hook', ->
			expect(@requests[0]).to.have.property('method').that.equals('post')
			expect(@requests[0]).to.have.property('url').that.match(/services\/vpn\/client-connect/)
			expect(@requests[0]).to.have.deep.property('form.uuid').that.equals(@client1.uuid)
			expect(@requests[0]).to.have.deep.property('form.vpn_address').that.match(/^10.1.0.[0-9]+$/)
			expect(@requests[0]).to.have.deep.property('form.remote_ip').that.equals('127.0.0.1')

		it 'and then a request to disconnect hook', ->
			expect(@requests[1]).to.have.property('method').that.equals('post')
			expect(@requests[1]).to.have.property('url').that.match(/services\/vpn\/client-disconnect/)
			expect(@requests[1]).to.have.deep.property('form.uuid').that.equals(@client1.uuid)
			expect(@requests[1]).to.have.deep.property('form.vpn_address').that.match(/^10.1.0.[0-9]+$/)
			expect(@requests[1]).to.have.deep.property('form.remote_ip').that.equals('127.0.0.1')

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
