#!/bin/bash

VPN_INSTANCE_ID=$1
if [ -f /usr/src/app/config/env ]; then
	source /usr/src/app/config/env
fi
API_PORT=$((VPN_API_BASE_PORT + VPN_INSTANCE_ID))

if [ "$common_name" == "API" ] || [ "$common_name" == "PROXY" ]; then
	curl -s -X DELETE \
		 $CURL_EXTRA_FLAGS \
		 -H 'Content-type: application/json' \
		 -d '{"ip": "$ifconfig_pool_remote_ip"}' \
		 "http://127.0.0.1:${API_PORT}/api/v1/privileged/ip" || true
fi

# TODO: Perhaps privileged clients shouldn't be unregistered below?

curl -s -X DELETE $CURL_EXTRA_FLAGS -H 'Content-type: application/json' -d @- "http://127.0.0.1:${API_PORT}/api/v1/clients" <<-EOF || true
{
	"event": "client-disconnect",
	"common_name": "$common_name",
	"virtual_address": "$ifconfig_pool_remote_ip",
	"real_address": "$trusted_ip",
	"trusted_port": "$trusted_port"
}
EOF
