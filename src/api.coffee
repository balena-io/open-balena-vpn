Promise = require 'bluebird'
express = require 'express'
bodyParser = require 'body-parser'
request = Promise.promisify(require('request'), multiArgs: true)
_ = require 'lodash'
passport = require 'passport'
BearerStrategy = require 'passport-http-bearer'
JWTStrategy = require('passport-jwt').Strategy
ExtractJwt = require('passport-jwt').ExtractJwt

passport.use new JWTStrategy
	secretOrKey: process.env.JSON_WEB_TOKEN_SECRET
	jwtFromRequest: ExtractJwt.fromAuthHeaderWithScheme('Bearer')
	(jwtPayload, done) ->
		if not jwtPayload?
			return done(null, false)

		# jwt should have a service property with value 'api'
		if jwtPayload.service is 'api'
			return done(null, true)
		done(null, false)

passport.use new BearerStrategy (token, done) ->
	if token is process.env.API_SERVICE_API_KEY
		return done(null, true)
	done(null, false)

clients = require './clients'

## Private endpoints should use the `fromLocalHost` middleware.
fromLocalHost = (req, res, next) ->
	# '::ffff:127.0.0.1' is the ipv4 mapped ipv6 address and ::1 is the ipv6 loopback
	if req.ip not in [ '127.0.0.1', '::ffff:127.0.0.1', '::1' ]
		return res.sendStatus(401)

	next()

module.exports = (vpn) ->
	api = express.Router()

	api.use(passport.initialize())
	api.use(bodyParser.json())

	api.get '/api/v1/clients/', passport.authenticate(['jwt', 'bearer'], session: false), (req, res) ->
		vpn.getStatus()
		.then (results) ->
			res.send(_.values(results.client_list))
		.catch (error) ->
			console.error('Error getting VPN client list', error)
			res.send(500, 'Error getting VPN client list')

	api.post '/api/v1/clients/', fromLocalHost, (req, res) ->
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
			timeout: 30000
			qs:
				apikey: apiKey
		request(requestOpts).get(0)
		.then (response) ->
			if response.statusCode == 200
				res.send('OK')
			else
				throw new Error('Authentication failed.')
		.catch (e) ->
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


	return api
