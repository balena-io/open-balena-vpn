#!/usr/bin/env sh
set -exu

cleanup() {
	exit_code=$?
	test -n "${test_id}" && docker rm -f "${test_id}"
	exit $exit_code
}
trap cleanup EXIT

test_id=$(docker run --privileged -d \
	-e RESIN_API_HOST=api.resindev.io \
	-e HAPROXY_ACCEPT_PROXY=false \
	-e VPN_INSTANCE_COUNT=1 \
	-e VPN_BASE_SUBNET=10.240.0.0/12 \
	-e VPN_INSTANCE_SUBNET_BITMASK=20 \
	-e VPN_BASE_PORT=10000 \
	-e VPN_BASE_MANAGEMENT_PORT=20000 \
	-e VPN_API_BASE_PORT=30000 \
	-e VPN_HOST=127.0.0.1 \
	-e VPN_CONNECT_INSTANCE_COUNT=1 \
	-e VPN_CONNECT_PROXY_PORT=3128 \
	-e VPN_SERVICE_API_KEY=test_api_key \
	-e PROXY_SERVICE_API_KEY=test_proxy_key \
	-e BLUEBIRD_DEBUG=1 \
	-e API_SERVICE_API_KEY=test_api_service_key \
	"${IMAGE_NAME}")

docker exec "${test_id}" /bin/sh -ec '
	while ! systemctl status basic.target >/dev/null 2>&1; do echo "Waiting for systemd..." && sleep 1; done
	systemctl stop confd.service
	mkdir -p /etc/systemd/system/confd.service.d
	echo "[Service]\nExecStart=\nExecStart=-/usr/local/bin/confd -onetime -confdir=/etc/confd -backend env" > /etc/systemd/system/confd.service.d/env-backend.conf
	systemctl daemon-reload
	ln -fs /etc/docker.env /usr/src/app/config/env
	echo "127.0.0.1 deadbeef.vpn" >> /etc/hosts
	systemctl stop resin-connect-proxy.service
	systemctl start haproxy.service
	npm install
	npm run lint
	npm run test-unit
	./node_modules/mocha/bin/mocha test/app.coffee'
