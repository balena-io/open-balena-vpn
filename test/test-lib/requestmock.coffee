mockery = require 'mockery'
request = require 'request'

# Hack to be able to change mock between testcases
# and to be able to use the default module for some requests
# and mock for others.

requestMock =
	defaultHandler: request
	handlers: {}
	enable: (url, handler) ->
		@handlers[url] = handler
	disable: ->
		@handlers = {}
	getHandler: (url) ->
		if url of @handlers
			return @handlers[url]
		else
			return @defaultHandler
	register: (opts, cb) ->
		console.log('requestmock', opts)
		if opts.url.indexOf('?') != -1
			url = opts.url.slice(0, opts.url.indexOf('?'))
		else
			{ url } = opts
		requestMock.getHandler(url)(opts, cb)

mockery.enable(warnOnUnregistered: false)
mockery.registerMock('requestretry', requestMock.register)
mockery.registerMock('request', requestMock.register)

exports.requestMock = requestMock
