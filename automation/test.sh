#!/usr/bin/env sh

# Copyright (C) 2015 Resin.io Ltd.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

set -eu
cleanup() {
	exit_code=$?
	test -n "${test_id}" && docker rm -f "${test_id}" >/dev/null
	exit $exit_code
}
trap cleanup EXIT

test_id=$(docker run --privileged -d \
	--tmpfs /run \
	--tmpfs /sys/fs/cgroup \
	-e RESIN_VPN_PRODUCTION=false \
	-e RESIN_API_HOST=api.resin.test \
	-e RESIN_VPN_PORT=443 \
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
	-e API_SERVICE_API_KEY=test_api_service_key \
	-e BLUEBIRD_DEBUG=1 \
	"${IMAGE_NAME}")

docker exec "${test_id}" /bin/sh -ec '
	echo -n "Waiting for systemd... "
	while ! systemctl status basic.target >/dev/null 2>&1; do sleep 1; done
	echo "ok"
	systemctl stop confd.service
	echo "[Service]\nType=oneshot\nExecStart=\nExecStart=-/usr/local/bin/confd -onetime -confdir=/etc/confd -backend env -log-level debug\nRemainAfterExit=yes" > /etc/systemd/system/confd.service.d/env-backend.conf
	ln -fs /etc/docker.env /usr/src/app/config/env
	echo "127.0.0.1 deadbeef.vpn" >> /etc/hosts
	systemctl daemon-reload
	systemctl start haproxy.service
	npm install
	npm run test-unit
	npx mocha test/app.ts'
