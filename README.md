# Open Balena VPN

## Description

Open Balena VPN augments an OpenVPN server with the
following components/features:

* `open-balena-connect-proxy` is a http connect proxy that
  handles connections through the vpn to services on connected devices, used by
  external services.
* `open-balena-vpn` which consists of an internal API for handling
  authentication and tracking device state, and spawns openvpn server instances
* haproxy used for balancing new connections between openvpn instances
* [libnss-openvpn](http://github.com/resin-io-modules/libnss-openvpn) is used to
  handle dns lookups of devices for connections via `open-balena-connect-proxy`

## Networking

Networking is configured by a number of environmental variables:

* `RESIN_VPN_GATEWAY` (*optional*) dictates the server end of the p2p connection
* `VPN_BASE_SUBNET` in CIDR notation is the entire subnet used for all servers
* `VPN_INSTANCE_SUBNET_BITMASK` is the VLSM to split `VPN_BASE_SUBNET` into
* `VPN_BASE_PORT`, `VPN_BASE_MANAGEMENT_PORT` and `VPN_API_BASE_PORT`

Given a base subnet of `10.240.0.0/12` and a per-instance VLSM of `20` a server
the first instance subnet would be `10.240.0.0/20` and the second would be
`10.240.16.0/20`, and so forth up to `10.255.240.0/20` for the 256th instance.

If `RESIN_VPN_GATEWAY` is not defined then the first usable address of the
instance subnet will be used in its place. This address, and the second usable
address, are used to facilitate the virtual p2p connections by openvpn.

The rest of the subnet, the third usable address to the last usable address,
is used as a DHCP pool for devices.

Note that the dhcp pool size will also dictate the max clients per
process, with the max clients per server being
`max_clients_per_instance * VPN_INSTANCE_COUNT` and not the size of
the base subnet. A VLSM of `20` will allow for 4094 clients per instance.

Base ports are increments by the process instance ID (1-indexed) to calculate
the port for that instance.

## DNS

OpenVPN writes connected client information to
`/var/run/openvpn/server-${id}.status` which are interrogated by libnss-openvpn
allowing for lookup of connected device VPN addresses via uuid.

## Client Authentication

VPN client authentication is initially handled by a simple script which uses
`curl` to pass the username and password (device UUID and Balena API key) to the
internal `open-balena-vpn` API, which in turn makes a request to
`open-balena-api` and ultimately decides the fate of the client.

## Client State

Client state is tracked via [openvpn scripts](https://github.com/resin-io/open-balena-vpn/tree/master/openvpn/scripts)
executed on connect/disconnect events which in turn use `curl` to hit
the relevant internal [api endpoints](https://github.com/resin-io/open-balena-vpn/blob/master/src/api.ts).

## Accessing Clients

Connections to devices can be established via `open-balena-connect-proxy` which
exposes a HTTP CONNECT Proxy server allowing for access to devices via a
hostname in the format `{deviceUUID}.resin:{port}`. The destination port
is limited based on the requesting user and device configuration. The
listening port is configured by the `VPN_CONNECT_PROXY_PORT` variable.
