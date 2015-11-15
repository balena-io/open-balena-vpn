#!/bin/bash
set -e
cleanup() {
	exit_code=$?
	if [ -n "$test_id" ]; then
		docker rm -f $test_id
	fi
	exit $exit_code
}
trap "cleanup" EXIT
test_id=$(docker run \
	--privileged -d \
	-e RESIN_API_HOST=api.resindev.io \
	-e VPN_SERVICE_API_KEY=test_api_key \
	-e VPN_HOST=127.0.0.1 \
	-e VPN_MANAGEMENT_NEW_PORT=11195 \
	-e VPN_MANAGEMENT_PORT=11194 \
	-e VPN_PRIVILEGED_SUBNET=10.255.255.0/24 \
	-e VPN_SUBNET=10.0.0.0/8 \
	-e VPN_API_PORT=80 \
	-e VPN_CONNECT_PROXY_PORT=3128 \
	-e JSON_WEB_TOKEN_SECRET=jwtsecret \
	$IMAGE_NAME)
docker exec $test_id /bin/sh -c 'npm install && systemctl stop resin-vpn.service && ./node_modules/.bin/coffeelint ./src ./test && ./node_modules/mocha/bin/mocha --bail --compilers coffee:coffee-script/register test/app.coffee'
