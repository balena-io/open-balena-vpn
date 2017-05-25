#!/usr/bin/env sh
set -ex

test -n "${IMAGE_NAME}" || (echo "IMAGE_NAME not set" && exit 1)

cleanup() {
	exit_code=$?
	test -n "${test_id}" && docker rm -f "${test_id}"
	exit $exit_code
}
trap cleanup EXIT

test_id=$(docker run --privileged -d \
	-e RESIN_API_HOST=api.resindev.io \
	-e RESIN_VPN_GATEWAY=10.2.0.1 \
	-e VPN_SERVICE_API_KEY=test_api_key \
	-e PROXY_SERVICE_API_KEY=test_proxy_key \
	-e VPN_HOST=127.0.0.1 \
	-e VPN_MANAGEMENT_PORT=11195 \
	-e VPN_API_PORT=80 \
	-e VPN_CONNECT_PROXY_PORT=3128 \
	-e BLUEBIRD_DEBUG=1 \
	-e JSON_WEB_TOKEN_SECRET=jwtsecret \
	-e API_SERVICE_API_KEY=test_api_service_key \
	"${IMAGE_NAME}")

docker exec "${test_id}" /bin/sh -ec '
	while ! systemctl status basic.target >/dev/null 2>&1; do echo "Waiting for D-Bus..." && sleep 1; done
	systemctl stop confd.service
	mkdir -p /etc/systemd/system/confd.service.d
	echo "[Service]\nExecStart=\nExecStart=-/usr/local/bin/confd -onetime -confdir=/etc/confd -backend env" > /etc/systemd/system/confd.service.d/env-backend.conf
	systemctl daemon-reload
	systemctl start confd.service
	systemctl stop resin-vpn.service resin-connect-proxy.service
	systemctl start openvpn@server.service
	echo "127.0.0.1 deadbeef.vpn" >> /etc/hosts
	npm install
	npm run lint
	npm run test-unit
	./node_modules/mocha/bin/mocha test/app.coffee'
