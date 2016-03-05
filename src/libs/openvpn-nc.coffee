_ = require 'lodash'
es = require 'event-stream'
net = require 'net'
Promise = require 'bluebird'

exports.parseResults = parseResults = (results) ->
	if not _.isString(results)
		throw new Error('Expected parameter `results` to be a string')

	status =
		routing_table: {}
		client_list: {}

	results
	.split('\r\n')
	.map((line) -> line.split(','))
	.forEach ([type, data...]) ->
		switch type
			when 'TITLE'
				status.title = data[0]
			when 'TIME'
				status.time = data[0]
				status.time_t = data[1]
			when 'CLIENT_LIST'
				status.client_list[data[0]] =
					common_name: data[0]
					real_address: data[1]
					virtual_address: data[2]
					bytes_received: data[3]
					bytes_sent: data[4]
					connected_since: data[5]
					connected_since_t: data[6]
			when 'ROUTING_TABLE'
				status.routing_table[data[1]] =
					virtual_address: data[0]
					common_name: data[1]
					real_address: data[2]
					last_ref: data[3]
					last_ref_t: data[4]
	return status

class OpenVPN
	constructor: (@port, @host = 'localhost') ->

	getConnection: ->
		Promise.try =>
			# net.connect either emits "connect" event on success or "error" event.
			conn = net.connect(@port, @host)
			new Promise (resolve, reject) ->
				conn.on('connect', -> resolve(conn))
				conn.on('error', reject)
			.disposer (conn) ->
				conn.destroy()

	execCommand: (command) ->
		Promise.using @getConnection(), (conn) ->
			# make sure we read stream until the end of command output
			conn = es.pipeline(conn, es.split('\nEND'))
			conn.end(command + '\n')

			new Promise (resolve, reject) ->
				conn.on('data', resolve)
				conn.on('error', reject)
				conn.on('close', reject)
			.timeout(60000)

	getStatus: (format = 2) ->
		@execCommand("status #{format}").then(parseResults)

exports.OpenVPN = OpenVPN
