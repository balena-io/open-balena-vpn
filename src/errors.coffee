_ = require 'lodash'
Raven = require 'raven'
TypedError = require 'typed-error'

exports.Raven = do ->
	do _.once ->
		Raven.config(process.env.SENTRY_DSN? and process.env.SENTRY_DSN, {
			captureUnhandledRejections: true
			release: process.env.npm_package_version
			environment: process.env.NODE_ENV
		}).install()
	return Raven

exports.captureException = (err, message, options) ->
	console.error(message, err?.message or err, err.stack)
	options ?= {}
	if message?
		options.extra ?= {}
		options.extra.message = message
	exports.Raven.captureException(err, options)

exports.HandledTunnelingError = class HandledTunnelingError extends TypedError
