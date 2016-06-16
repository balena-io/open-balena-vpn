Promise = require 'bluebird'
chai = require 'chai'
sinon = require 'sinon'
sinonChai = require 'sinon-chai'
chaiAsPromised = require 'chai-as-promised'

net = require 'net'
stream = require 'stream'
duplexer = require 'duplexer2'

chai.use(sinonChai)
chai.use(chaiAsPromised)

expect = chai.expect

{ parseResults, OpenVPN } = require '../../src/libs/openvpn-nc'

describe 'parseResults', ->
	it 'should throw an exception if input is not a string', ->
		fn = -> parseResults(null)
		expect(fn).to.throw()

	it 'should parse the empty string', ->
		input = ''
		output =
			client_list: {}
			routing_table: {}

		expect(parseResults(input)).to.deep.equal(output)

	it 'should ignore corrupted input', ->
		input = 'CORRUPTED'
		output =
			client_list: {}
			routing_table: {}

		expect(parseResults(input)).to.deep.equal(output)

	it 'should parse the directive TITLE', ->
		input = 'TITLE,OpenVPN 2.3.4 x86_64-pc-linux-gnu [SSL (OpenSSL)] [LZO]'
		output =
			title: 'OpenVPN 2.3.4 x86_64-pc-linux-gnu [SSL (OpenSSL)] [LZO]'
			client_list: {}
			routing_table: {}

		expect(parseResults(input)).to.deep.equal(output)

	it 'should parse the directive TIME', ->
		input = 'TIME,Sat Feb 27 09:18:09 2016,1456564689'
		output =
			time: 'Sat Feb 27 09:18:09 2016'
			time_t: '1456564689'
			client_list: {}
			routing_table: {}

		expect(parseResults(input)).to.deep.equal(output)

	it 'should parse the directive CLIENT_LIST', ->
		input = 'CLIENT_LIST,deadbeef,10.0.189.166:21703,10.2.0.159,169292,189446,Sat Feb 27 01:09:20 2016,1456535360,deadbeef'
		output =
			client_list:
				deadbeef:
					common_name: 'deadbeef'
					real_address: '10.0.189.166:21703'
					virtual_address: '10.2.0.159'
					bytes_received: '169292'
					bytes_sent: '189446'
					connected_since: 'Sat Feb 27 01:09:20 2016'
					connected_since_t: '1456535360'
			routing_table: {}

		expect(parseResults(input)).to.deep.equal(output)

	it 'should parse the directive ROUTING_TABLE', ->
		input = 'ROUTING_TABLE,10.2.1.150,deadbeef,10.0.189.166:21712,Sat Feb 27 01:10:02 2016,1456535402'
		output =
			client_list: {}
			routing_table:
				deadbeef:
					virtual_address: '10.2.1.150'
					common_name: 'deadbeef'
					real_address: '10.0.189.166:21712'
					last_ref: 'Sat Feb 27 01:10:02 2016'
					last_ref_t: '1456535402'

		expect(parseResults(input)).to.deep.equal(output)

	it 'should parse multiple directives together', ->
		input = [
			'TITLE,OpenVPN 2.3.4 x86_64-pc-linux-gnu [SSL (OpenSSL)] [LZO]'
			'TIME,Sat Feb 27 09:18:09 2016,1456564689'
			'CLIENT_LIST,deadbeef,10.0.189.166:21703,10.2.0.159,169292,189446,Sat Feb 27 01:09:20 2016,1456535360,deadbeef'
			'ROUTING_TABLE,10.2.1.150,deadbeef,10.0.189.166:21712,Sat Feb 27 01:10:02 2016,1456535402'
		].join('\r\n')

		output =
			title: 'OpenVPN 2.3.4 x86_64-pc-linux-gnu [SSL (OpenSSL)] [LZO]'
			time: 'Sat Feb 27 09:18:09 2016'
			time_t: '1456564689'
			client_list:
				deadbeef:
					common_name: 'deadbeef'
					real_address: '10.0.189.166:21703'
					virtual_address: '10.2.0.159'
					bytes_received: '169292'
					bytes_sent: '189446'
					connected_since: 'Sat Feb 27 01:09:20 2016'
					connected_since_t: '1456535360'
			routing_table:
				deadbeef:
					virtual_address: '10.2.1.150'
					common_name: 'deadbeef'
					real_address: '10.0.189.166:21712'
					last_ref: 'Sat Feb 27 01:10:02 2016'
					last_ref_t: '1456535402'

		expect(parseResults(input)).to.deep.equal(output)

describe 'OpenVPN', ->
	it 'should be a function', ->
		expect(OpenVPN).to.be.a('function')

	it 'should construct an object', ->
		vpn = new OpenVPN()
		expect(vpn).to.be.an('object')
		expect(vpn.constructor).to.equal(OpenVPN)

	describe 'new OpenVPN()', ->
		it 'should default .host to "localhost"', ->
			vpn = new OpenVPN()
			expect(vpn.host).to.equal('localhost')

		it 'should set the constructor parameters as .host and .port', ->
			vpn = new OpenVPN(1234, 'foobar')
			expect(vpn.host).to.equal('foobar')
			expect(vpn.port).to.equal(1234)

	describe '.getConnection()', ->
		beforeEach ->
			@vpn = new OpenVPN(11195)

			@connMock = new net.Socket()
			sinon.stub(@connMock, 'connect')
			sinon.stub(@connMock, 'destroy')
			sinon.stub(net, 'connect').returns(@connMock)

		afterEach ->
			net.connect.restore()

		it 'should open a connection to localhost:11195', ->
			@vpn.getConnection()

			expect(net.connect).to.have.been.calledOnce
			expect(net.connect).to.have.been.calledWithExactly(11195, 'localhost')

		it 'should resolve to a connection object if the connection is successful', ->
			connPromise = @vpn.getConnection()
			@connMock.emit('connect')

			Promise.using connPromise, (conn) =>
				expect(conn).to.equal(@connMock)

		it 'should reject the promise if the connection is unsuccessful', ->
			connPromise = @vpn.getConnection()
			@connMock.emit('error')

			expect(Promise.using(connPromise, -> )).to.eventually.be.rejected

		it 'should destroy the connection in the disposer', ->
			connPromise = @vpn.getConnection()
			@connMock.emit('connect')

			Promise.using(connPromise, -> )
			.then =>
				expect(@connMock.destroy).to.have.been.calledOnce

	describe '.execCommand()', ->
		beforeEach ->
			@clock = sinon.useFakeTimers('setTimeout')

			@vpn = new OpenVPN(11195)

			a = new stream.PassThrough()
			b = new stream.PassThrough()
			@clientMock = duplexer(a, b)
			@serverMock = duplexer(b, a)
			sinon.spy(@clientMock, 'end')

			disposedConn = Promise.resolve(@clientMock).disposer(->)
			sinon.stub(@vpn, 'getConnection').returns(disposedConn)

		afterEach ->
			@clock.restore()

		it 'should return a promise', ->
			cmd = @vpn.execCommand()
			@serverMock.end()

			expect(cmd).to.be.an.instanceOf(Promise)

		it 'should reject the promise if an error happens', ->
			cmd = @vpn.execCommand('foobar')

			setImmediate =>
				@clientMock.emit('error', new Error('foobar'))

			expect(cmd).to.eventually.be.rejected

		it 'should send the command and half-close the connection', ->
			cmd = @vpn.execCommand('foobar')
			@serverMock.end('foobar')

			cmd.finally =>
				expect(@clientMock.end).to.have.been.calledWith('foobar\n')

		it 'should resolve to the data the server sent', ->
			cmd = @vpn.execCommand('foobar')
			@serverMock.end('foobar')

			expect(cmd).to.eventually.equal('foobar')

		it 'should join multiple data events to one', ->
			cmd = @vpn.execCommand('foobar')

			@serverMock.write('foo')
			@serverMock.write('bar')
			@serverMock.end()

			expect(cmd).to.eventually.equal('foobar')

		it 'should join multiple data events until "\\nEND" is encountered', ->
			cmd = @vpn.execCommand('foobar')

			@serverMock.write('foo')
			@serverMock.write('bar')
			@serverMock.write('\nEND\nbaz')
			@serverMock.end()

			expect(cmd).to.eventually.equal('foobar')

		it 'should timeout after 60 seconds', ->
			cmd = @vpn.execCommand('foobar')

			setImmediate =>
				@clock.tick(60000)

			expect(cmd).to.eventually.be.rejectedWith(Promise.TimeoutError)

	describe 'getStatus', ->
		beforeEach ->
			@vpn = new OpenVPN(11195)
			@execCommandStub = sinon.stub(@vpn, 'execCommand').returns(Promise.resolve(''))

		it 'should return a promise', ->
			expect(@vpn.getStatus()).to.be.an.instanceOf(Promise)

		it 'should run the "status" management command with a default parameter of 2', ->
			@vpn.getStatus()
			expect(@vpn.execCommand).to.have.been.calledWithExactly('status 2')

		it 'should run the "status" management command with the specified format type', ->
			@vpn.getStatus(5)
			expect(@vpn.execCommand).to.have.been.calledWithExactly('status 5')

		it 'should resolve to the currently connected clients', ->
			input = [
				'TITLE,OpenVPN 2.3.4 x86_64-pc-linux-gnu [SSL (OpenSSL)] [LZO]'
				'TIME,Sat Feb 27 09:18:09 2016,1456564689'
				'CLIENT_LIST,deadbeef,10.0.189.166:21703,10.2.0.159,169292,189446,Sat Feb 27 01:09:20 2016,1456535360,deadbeef'
				'ROUTING_TABLE,10.2.1.150,deadbeef,10.0.189.166:21712,Sat Feb 27 01:10:02 2016,1456535402'
			].join('\r\n')

			output =
				title: 'OpenVPN 2.3.4 x86_64-pc-linux-gnu [SSL (OpenSSL)] [LZO]'
				time: 'Sat Feb 27 09:18:09 2016'
				time_t: '1456564689'
				client_list:
					deadbeef:
						common_name: 'deadbeef'
						real_address: '10.0.189.166:21703'
						virtual_address: '10.2.0.159'
						bytes_received: '169292'
						bytes_sent: '189446'
						connected_since: 'Sat Feb 27 01:09:20 2016'
						connected_since_t: '1456535360'
				routing_table:
					deadbeef:
						virtual_address: '10.2.1.150'
						common_name: 'deadbeef'
						real_address: '10.0.189.166:21712'
						last_ref: 'Sat Feb 27 01:10:02 2016'
						last_ref_t: '1456535402'

			@execCommandStub.returns(Promise.resolve(input))

			expect(@vpn.getStatus()).to.eventually.deep.equal(output)
