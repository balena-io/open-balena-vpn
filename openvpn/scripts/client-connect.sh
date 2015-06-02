#!/bin/bash
#WARNING: if this script fails openvpn interprets it as authentication failure

set -o errexit

if [ "$common_name" == "API" ] || [ "$common_name" == "PROXY" ]; then
	# If this fails, we simply can't assign an IP address so auth failure is
	# appropriate.
	client=$(curl -s -X POST \
				  $CURL_EXTRA_FLAGS \
				  -H 'Content-type: application/json' \
				  -d '{"common_name": "'$common_name'"}' \
				  "http://127.0.0.1/api/v1/privileged/ip")

	peer=$(curl -s "http://127.0.0.1/api/v1/privileged/peer?ip=$client")

	# $1 references a temporary config file path which openvpn will use to
	# dynamically adjust configuration (in a few limited respects) if it exists
	# after this script is called.
	echo "ifconfig-push $client $peer" > $1
	cat /etc/openvpn/privileged.conf >> $1
fi

# TODO: Perhaps privileged clients shouldn't be registered below?

curl -s -X POST $CURL_EXTRA_FLAGS -H 'Content-type: application/json' -d @- "http://127.0.0.1/api/v1/clients" <<-EOF || true
{
	"event": "client-connect",
	"common_name": "$common_name",
	"virtual_address": "$ifconfig_pool_remote_ip",
	"real_address": "$trusted_ip",
	"trusted_port": "$trusted_port"
}
EOF
