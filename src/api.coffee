Promise = require 'bluebird'
express = require 'express'
bodyParser = require 'body-parser'
request = Promise.promisify(require('request'))
_ = require 'lodash'

clients = require './clients'

# Require once we know we have sufficient env vars.
privileged = require './privileged'

notFromVpnClients = (vpnSubnet) ->
	return (req, res, next) ->
		if vpnSubnet.contains(req.ip) and not privileged.contains(req.ip)
			return res.sendStatus(401)

		next()

## Private endpoints should use the `fromLocalHost` middleware.
fromLocalHost = (req, res, next) ->
	if req.ip isnt '127.0.0.1'
		return res.sendStatus(401)

	next()

module.exports = (vpn, vpnSubnet) ->
	api = express.Router()

	api.use(bodyParser.json())
	api.use(notFromVpnClients(vpnSubnet))

	api.get '/api/v1/clients/', (req, res) ->
		vpn.getStatus()
		.then (results) ->
			res.send(_.values(results.client_list))
		.catch (error) ->
			console.error('Error getting VPN client list', error)
			res.send(500, 'Error getting VPN client list')

	api.post '/api/v1/clients/', (req, res) ->
		if not req.body.common_name?
			return res.sendStatus(400)
		if not req.body.virtual_address?
			return res.sendStatus(400)
		if not req.body.real_address?
			return res.sendStatus(400)
		if not req.body.trusted_port?
			return res.sendStatus(400)
		data = _.pick(req.body, [ 'common_name', 'virtual_address', 'real_address', 'trusted_port' ])
		clients.connected(data)
		res.send('OK')

	api.post '/api/v1/auth/', fromLocalHost, (req, res) ->
		if not req.body.username?
			console.log('AUTH FAIL: UUID not specified.')

			return res.sendStatus(400)
		if not req.body.password?
			console.log('AUTH FAIL: API Key not specified.')

			return res.sendStatus(400)
		username = req.body.username
		apiKey = req.body.password
		requestOpts =
			url: "https://#{process.env.RESIN_API_HOST}/services/vpn/auth/#{username}"
			qs:
				apikey: apiKey
		request(requestOpts).get(0)
		.then (response) ->
			if response.statusCode == 200
				res.send('OK')
			else
				throw new Error('Authentication failed.')
		.catch (e) ->
			console.log('authentication failed', e, e?.stack, username, apiKey)
			res.sendStatus(401)

	api.delete '/api/v1/clients/', fromLocalHost, (req, res) ->
		if not req.body.common_name?
			return res.sendStatus(400)
		if not req.body.virtual_address?
			return res.sendStatus(400)
		if not req.body.real_address?
			return res.sendStatus(400)
		if not req.body.trusted_port?
			return res.sendStatus(400)
		data = _.pick(req.body, [ 'common_name', 'virtual_address', 'real_address', 'trusted_port' ])
		clients.disconnected(data)
		res.send('OK')

	api.post '/api/v1/privileged/ip', fromLocalHost, (req, res) ->
		{ common_name } = req.body
		if not common_name?
			return res.sendStatus(400)

		ip = privileged.assign(common_name)
		return res.sendStatus(501) if !ip?

		res.send(ip)

	api.delete '/api/v1/privileged/ip', fromLocalHost, (req, res) ->
		{ ip } = req.body
		return res.sendStatus(400) if not ip?

		privileged.unassign(ip)
		# We output a message if unassigned ip provided, but this shouldn't be an error.
		res.send('OK')

	api.get '/api/v1/privileged/ip', fromLocalHost, (req, res) ->
		res.send(privileged.list())

	api.get '/api/v1/privileged/peer', fromLocalHost, (req, res) ->
		peer = privileged.peer(req.query.ip)
		if peer?
			res.send(peer)
		else
			res.sendStatus(400)

	return api
