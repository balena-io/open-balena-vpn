#!/bin/bash
#WARNING: if this script fails openvpn interprets it as authentication failure

set -o errexit
VPN_INSTANCE_ID=$1
if [ -f /usr/src/app/config/env ]; then
	source /usr/src/app/config/env
fi
API_PORT=$((VPN_API_BASE_PORT + VPN_INSTANCE_ID))

curl -s -X POST $CURL_EXTRA_FLAGS -H 'Content-type: application/json' -d @- "http://127.0.0.1:${API_PORT}/api/v1/clients" <<-EOF || true
{
	"event": "client-connect",
	"common_name": "$common_name",
	"virtual_address": "$ifconfig_pool_remote_ip",
	"real_address": "$trusted_ip",
	"trusted_port": "$trusted_port"
}
EOF
