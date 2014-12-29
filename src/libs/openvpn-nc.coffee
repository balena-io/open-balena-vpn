es = require 'event-stream'
net = require 'net'
Promise = require 'bluebird'

class OpenVPN
	constructor: (@port, @host='localhost') ->
		connect = =>
			@conn = new Promise (resolve, reject) =>
				conn = net.connect(@port, @host)
				conn.on('error', reject)
				conn.on('connect', -> resolve(es.pipeline(conn, es.split('\nEND'))))
				conn.on('close', connect)
		connect()

	execCommand: (command) ->
		@conn.then (conn) ->
			conn.write(command + '\n')
			return new Promise((resolve) -> conn.once('data', resolve))

	getStatus: (format=2) ->
		@execCommand("status #{format}").then (results) ->
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

module.exports = OpenVPN
