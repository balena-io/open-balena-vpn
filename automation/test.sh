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

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

test_id=$(docker run \
	--privileged -d \
	-e RESIN_API_HOST=api.resindev.io \
	-e RESIN_VPN_GATEWAY=10.2.0.1 \
	-e VPN_SERVICE_API_KEY=test_api_key \
	-e VPN_HOST=127.0.0.1 \
	-e VPN_MANAGEMENT_PORT=11195 \
	-e VPN_API_PORT=80 \
	-e VPN_CONNECT_PROXY_PORT=3128 \
	-e BLUEBIRD_DEBUG=1 \
	-e JSON_WEB_TOKEN_SECRET=jwtsecret \
	-v $DIR/env-backend.conf:/etc/systemd/system/confd.service.d/env-backend.conf \
	$IMAGE_NAME)
docker exec $test_id /bin/sh -c '\
	npm install \
	&& systemctl stop resin-vpn.service resin-connect-proxy.service \
	&& ./node_modules/.bin/coffeelint ./src ./test \
	&& echo "127.0.0.1 deadbeef.vpn" >> /etc/hosts \
	&& npm run test-unit \
	&& ./node_modules/mocha/bin/mocha test/app.coffee'
