#!/bin/bash

if [ "$common_name" == "API" ] || [ "$common_name" == "PROXY" ]; then
	curl -s -X DELETE \
		 $CURL_EXTRA_FLAGS \
		 -H 'Content-type: application/json' \
		 -d '{"ip": "$ifconfig_pool_remote_ip"}' \
		 "http://127.0.0.1/api/v1/privileged/ip" || true
fi

# TODO: Perhaps privileged clients shouldn't be unregistered below?

curl -s -X DELETE $CURL_EXTRA_FLAGS -H 'Content-type: application/json' -d @- "http://127.0.0.1/api/v1/clients" <<-EOF || true
{
	"event": "client-disconnect",
	"common_name": "$common_name",
	"virtual_address": "$ifconfig_pool_remote_ip",
	"real_address": "$trusted_ip",
	"trusted_port": "$trusted_port"
}
EOF
