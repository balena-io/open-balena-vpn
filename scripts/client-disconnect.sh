#!/bin/bash

if [ "$common_name" == "API" ] || [ "$common_name" == "PROXY" ]; then
	source /app/scripts/unassign-privileged.sh $ifconfig_pool_remote_ip
fi

# TODO: Perhaps privileged clients shouldn't be unregistered below?

curl -s -X DELETE \
	 -H 'Content-type: application/json' \
	 -d '{"event":"client-disconnect","common_name":"'$common_name'","virtual_address":"'$ifconfig_pool_remote_ip'","real_address":"'$trusted_ip'"}' \
	 "http://127.0.0.1/api/v1/clients"
