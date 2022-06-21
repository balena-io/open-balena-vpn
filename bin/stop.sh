#!/usr/bin/env bash
set -ae

[[ $DEFAULT_VERBOSE_LOGS =~ on|On|Yes|yes|true|True ]] && set -x

WORK_DIR="$(readlink -e "$(dirname "$0")"/..)"
PATH="${WORK_DIR}/node_modules/.bin:${PATH}"

function cleanup() {
	echo 'show servers state' | socat - "${VPN_HAPROXY_SOCKET}"
}

trap 'cleanup' EXIT

cd "${WORK_DIR}"

# shellcheck disable=SC1091
test -f "${WORK_DIR}/config/env" && source "${WORK_DIR}/config/env"

# prevent new VPN connections by setting backend VPN workers to DRAIN mode
# https://cbonte.github.io/haproxy-dconv/2.5/snapshot/management.html#9.3
# shellcheck disable=SC1001
for vpn_worker in $(echo 'show servers conn' | socat - "${VPN_HAPROXY_SOCKET}" \
  | grep -E ^vpn-workers\/vpn \
  | awk '{print $1}'); do
       echo "set server ${vpn_worker} state drain" | socat - "${VPN_HAPROXY_SOCKET}"
done
