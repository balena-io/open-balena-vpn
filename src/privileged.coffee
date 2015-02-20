Netmask = require('netmask').Netmask

privileged = new Netmask(process.env.VPN_PRIVILEGED_SUBNET)

ips = {}

class IpFoundError
	constructor: (@ip) ->

# We have to manually assign privileged IP addresses as OpenVPN doesn't provide
# an easy means of selectively providing a dynamic pool of IP addresses
# depending on the connecting client.
#
# The client-connect.sh and client-disconnect.sh scripts run POST and DELETE
# requests against /api/v1/privileged/ip respectively to obtain and release IP
# addresses.

module.exports =
	contains: (ip) ->
		return privileged.contains(ip)

	list: ->
		lines = ("#{ip}\t#{name}" for ip, name of ips when name?)
		return lines.join('\n') + '\n'

	assign: (name) ->
		# This could be done more efficiently algorithm-wise, but I don't think it's
		# worth it given the small number of privileged clients and the fact they
		# will be [dis]connecting infrequently.
		try
			privileged.forEach (ip, long) ->
				# Even numbered IP address reserved for peer.
				return if long % 2 == 0

				if !ips[ip]?
					ips[ip] = name or 'unknown'
					throw new IpFoundError(ip)
		catch err
			return err.ip if err instanceof IpFoundError

			throw err

		return null

	unassign: (ip) ->
		if !ips[ip]?
			return console.log("Attempting to release #{ip} but not assigned.")

		ips[ip] = null

	peer: (ip) ->
		if not ip? or !privileged.contains(ip)
			return null

		octets = ip.split('.')
		lastOctet = parseInt(octets?[3], 10)

		# The input should be sane, and since peer IP addresses are by (our)
		# convention even, the input ip address shouldn't be.
		if isNaN(lastOctet) or !(0 < lastOctet < 256) or lastOctet % 2 == 0
			return null

		# We simply increment the last octet to obtain the IPv4 address's peer.
		octets[3] = lastOctet + 1

		return octets.join('.')
