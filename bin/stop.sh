#!/usr/bin/env bash
set -ae

[[ $DEFAULT_VERBOSE_LOGS =~ on|On|Yes|yes|true|True ]] && set -x

WORK_DIR="$(readlink -e "$(dirname "$0")"/..)"
PATH="${WORK_DIR}/node_modules/.bin:${PATH}"

function cleanup() {
	echo 'show servers state' | socat - /var/run/haproxy.sock
}

trap 'cleanup' EXIT

cd "${WORK_DIR}"

# shellcheck disable=SC1091
test -f "${WORK_DIR}/config/env" && source "${WORK_DIR}/config/env"

# prevent new VPN connections by setting backend VPN workers to DRAIN mode
# https://cbonte.github.io/haproxy-dconv/2.5/snapshot/management.html#9.3
for vpn_worker in $(echo 'show servers conn' | socat - /run/haproxy.sock \
  | grep -E ^vpn-workers\/vpn \
  | awk '{print $1}'); do
       echo "set server ${vpn_worker} state drain" | socat - /run/haproxy.sock
done

# signal master to prepare for termination
pgrep -f app.js && pgrep -f app.js | head -n 1 | xargs kill --signal TERM
