{ EventEmitter2 } = require 'eventemitter2'
{ Tail } = require 'tail'

# Export an EventEmitter that emits events from OpenVPN server.
module.exports = exports = events = new EventEmitter2()

if not process.env.VPN_EVENTS_FILE?
	console.log('VPN_EVENTS_FILE env variable is not set')
	process.exit(1)

path = process.env.VPN_EVENTS_FILE

# Remove file to ignore previous events
# to avoid re-reading past events in case of restart
tail = new Tail(path)
tail.on 'line', (line) ->
	data = JSON.parse(line)
	events.emit(data.event, data)
tail.on 'error', (err) ->
	events.emit('error', err)
