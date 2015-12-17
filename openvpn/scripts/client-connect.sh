#!/bin/bash
#WARNING: if this script fails openvpn interprets it as authentication failure

set -o errexit

curl -s -X POST $CURL_EXTRA_FLAGS -H 'Content-type: application/json' -d @- "http://127.0.0.1/api/v1/clients" <<-EOF || true
{
	"event": "client-connect",
	"common_name": "$common_name",
	"virtual_address": "$ifconfig_pool_remote_ip",
	"real_address": "$trusted_ip",
	"trusted_port": "$trusted_port"
}
EOF
