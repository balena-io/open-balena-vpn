Promise = require 'bluebird'
csrgen = Promise.promisify(require('csr-gen'))
request = Promise.promisifyAll(require('request'))
crypto = require 'crypto'
fs = Promise.promisifyAll(require('fs'))
_ = require 'lodash'
path = require 'path'
{ spawn } = require 'child_process'

CA_ENDPOINT = process.env.CA_ENDPOINT ? 'http://ca.resindev.io:9292/1/certificate/issue/'
CA_NAME = process.env.CA_NAME ? 'resin_dev'
VPN_HOST = process.env.VPN_HOST ? '127.0.0.1'
VPN_PORT = process.env.VPN_PORT ? 1194
CA_CERT_PATH = process.env.CA_CERT_PATH ? '/app/test/data/ca.crt'

exports.getSignedCertificate = getSignedCertificate = (uuid, caEndpoint, caName, outputDir) ->
	csrgen(uuid,
		company: 'Rulemotion Ltd'
		csrName: 'client.csr'
		keyName: 'client.key'

		outputDir: outputDir
		email: 'vpn@resin.io'
		read: true
		country: ''
		city: ''
		state: ''
		division: ''
	).then (keys) ->
		options =
			url: caEndpoint
			form:
				ca: caName
				profile: 'client'
				validityPeriod: 31536000
				'subject[O]': 'Rulemotion Ltd'
				'subject[CN]': uuid,
				csr: keys.csr
		return request.postAsync(options)
		.spread (res, body) ->
			return body

exports.writeVPNConfiguration = writeVPNConfiguration = (confDir, ca, cert, vpnhost, vpnport) ->
	fs.readFileAsync(__dirname + '/openvpn.conf.tmpl', 'utf8')
	.then (tmpl) ->	
		Promise.all( [
			fs.writeFileAsync("#{confDir}/client.conf", _.template(tmpl)({ ca, cert, vpnhost, vpnport })),
			fs.writeFileAsync("#{confDir}/ca.crt", ca),
			fs.writeFileAsync("#{confDir}/client.crt", cert)
		] )

exports.createVPNClient = createVPNClient = (baseDir) ->
	uuid = crypto.pseudoRandomBytes(31).toString('hex')
	confDir = "/app/test/data/#{uuid}"

	fs.mkdirAsync(confDir)
	.then ->
		cert = getSignedCertificate(uuid, CA_ENDPOINT, CA_NAME, confDir)
		ca = fs.readFileAsync(CA_CERT_PATH, 'utf8')
		return [ cert, ca ]
	.spread (cert, ca) ->
		writeVPNConfiguration(confDir, ca, cert, VPN_HOST, VPN_PORT)
	.then ->
		new Promise (resolve, reject) ->
			openvpn = spawn('openvpn', [ 'client.conf' ], cwd: confDir)

			# Prefix and log all OpenVPN output
			openvpn.stdout.on 'data', (data) ->
				# console.log('OPENVPN: ', data.toString())
				if data.toString().match('Initialization Sequence Completed')
					resolve(openvpn)
	.then (proc) ->
		return {
			uuid: uuid
			disconnect: ->
				new Promise (resolve, reject) ->
					proc.kill()
					proc.on 'exit', ->
						resolve()
		}
	.catch (err) ->
		console.log('Error creating VPN client', err)
