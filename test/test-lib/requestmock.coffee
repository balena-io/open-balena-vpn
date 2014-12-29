mockery = require 'mockery'
request = require 'request'

# Hack to be able to change mock between testcases
# and to be able to use the default module for some requests
# and mock for others.

requestMock =
	defaultHandler: request
	handlers: {}
	enable: (url, handler) ->
		this.handlers[url] = handler
	disable: ->
		this.handlers = {}
	getHandler: (url) ->
		if url of this.handlers
			return this.handlers[url]
		else
			return this.defaultHandler

mockery.enable(warnOnUnregistered: false)
mockery.registerMock 'request', (opts, cb) ->
	url = opts.url.slice(0, opts.url.indexOf('?'))
	requestMock.getHandler(url)(opts, cb)

exports.requestMock = requestMock
