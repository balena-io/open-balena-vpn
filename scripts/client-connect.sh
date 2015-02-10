#!/bin/bash
#WARNING: if this script fails openvpn interprets it as authentication failure
curl -s -X POST \
	 -H 'Content-type: application/json' \
	 -d '{"event":"client-connect","common_name":"'$common_name'","virtual_address":"'$ifconfig_pool_remote_ip'","real_address":"'$trusted_ip'"}' \
	 "http://127.0.0.1/api/v1/clients" || true
