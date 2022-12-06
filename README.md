# openBalena VPN

## Description

openBalena VPN augments an OpenVPN server with the following components/features:

* `open-balena-connect-proxy` is a http connect proxy that
  handles connections through the vpn to services on connected devices, used by
  external services such as `balena-proxy`
* `open-balena-vpn-api` which consists of an internal API for handling
  authentication and tracking device state, and spawns openvpn server instances
* haproxy used for balancing new connections between openvpn instances
* [libnss-openvpn](http://github.com/balena-io-modules/libnss-openvpn) is used to
  handle dns lookups of devices for connections via `open-balena-connect-proxy`

## Networking

Networking is configured by a number of environmental variables:

* `VPN_GATEWAY` (*optional*) dictates the server end of the p2p connection
* `VPN_BASE_SUBNET` in CIDR notation is the entire subnet used for all servers
* `VPN_INSTANCE_SUBNET_BITMASK` is the VLSM to split `VPN_BASE_SUBNET` into
  `VPN_BASE_PORT` and `VPN_BASE_MANAGEMENT_PORT`

Given a base subnet of `100.64.0.0/10` and a per-instance VLSM of `20` a server
the first instance subnet would be `100.64.0.0/20` and the second would be
`100.64.16.0/20`, and so forth up to `100.127.240.1/20` for the 1024th instance.

If `VPN_GATEWAY` is not defined then the first usable address of the
instance subnet will be used in its place. This address, and the second usable
address, are used to facilitate the virtual p2p connections by openvpn.

The rest of the subnet, the third usable address to the last usable address,
is used as a DHCP pool for devices.

Note that the dhcp pool size will also dictate the max clients per
process, with the max clients per server being
`max_clients_per_instance * VPN_INSTANCE_COUNT` and not the size of
the base subnet. A VLSM of `20` will allow for 4,094 clients per instance, and a
base subnet of size `/10` will allow for a total of 4,194,302 clients.

Base ports are increments by the process instance ID (1-indexed) to calculate
the port for that instance.

## DNS

OpenVPN writes connected client information to
`/var/run/openvpn/server-${id}.status` which are interrogated by libnss-openvpn
allowing for lookup of connected device VPN addresses via uuid.

## Client Authentication / State

VPN client authentication is initiated via an event from the vpn management
console which proxies the credentials to the balena api which ultimately
decides the fate of the client.

## Accessing Clients

Connections to devices can be established via `open-balena-connect-proxy` which
exposes a HTTP CONNECT Proxy server allowing for access to devices via a
hostname in the format `{deviceUUID}.balena:{port}`. The destination port
is limited based on the requesting user and device configuration. The
listening port is configured by the `VPN_CONNECT_PROXY_PORT` variable.
