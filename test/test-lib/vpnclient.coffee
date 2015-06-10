Promise = require 'bluebird'
request = Promise.promisifyAll(require('request'))
fs = Promise.promisifyAll(require('fs'))
_ = require 'lodash'
path = require 'path'
{ spawn } = require 'child_process'
tmp = Promise.promisifyAll(require('tmp'))

VPN_HOST = VPN_HOST ? '127.0.0.1'
VPN_PORT = VPN_PORT ? 443
CA_CERT_PATH = CA_CERT_PATH ? path.resolve(__dirname, '../data/ca.crt')

writeVPNConfiguration = (confDir, uuid, apiKey) ->
	authfile = confDir + "/auth-file"
	Promise.all( [
		fs.readFileAsync(__dirname + '/openvpn.conf.tmpl', 'utf8')
		fs.readFileAsync(CA_CERT_PATH)
		fs.writeFileAsync(authfile, "#{uuid}\n#{apiKey}\n")
	] )
	.spread (tmpl, ca) ->
	       [
		       fs.writeFileAsync("#{confDir}/client.conf", _.template(tmpl)({ vpnhost: VPN_HOST, vpnport: VPN_PORT, authfile })),
		       fs.writeFileAsync("#{confDir}/ca.crt", ca),
	       ]


exports.createVPNClient = createVPNClient = (uuid, apiKey) ->
	confDir = path.resolve(__dirname, "../data/#{uuid}")
	vpnAddress = null

	fs.mkdirAsync(confDir)
	.then ->
		writeVPNConfiguration(confDir, uuid, apiKey)
	.then ->
		new Promise (resolve, reject) ->
			openvpn = spawn('openvpn', [ 'client.conf' ], cwd: confDir)

			# Prefix and log all OpenVPN output
			openvpn.stdout.on 'data', (data) ->
				data = data.toString()
				console.log('vpn', data.toString())
				m = data.match(///
					PUSH:\ Received\ control\ message:\ '
						PUSH_REPLY,
						route\ [0-9.]+\ [0-9.]+,
						topology\ \w+,
						ping\ \w+,
						ping-restart\ \w+,
						ifconfig\ ([0-9.]+)\ [0-9.]+
					'
				///)
				if m
					[fullText, vpnAddress] = m
				if data.match('Initialization Sequence Completed')
					resolve(openvpn)
			openvpn.on 'close', (code) ->
				reject(new Error('OpenVPN client exited with code ' + code))
	.then (proc) ->
		return {
			uuid,
			apiKey,
			vpnAddress,
			disconnect: ->
				new Promise (resolve, reject) ->
					proc.kill()
					proc.on 'exit', ->
						resolve()
		}
	.catch (err) ->
		console.log('Error creating VPN client', err)
		throw new Error(err)
