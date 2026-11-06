#!/usr/bin/env bash
# shellcheck disable=SC2154

set -ae

[[ ${DEFAULT_VERBOSE_LOGS} =~ on|On|Yes|yes|true|True ]] && set -x

WORK_DIR="/usr/src/app"
PATH="${WORK_DIR}/node_modules/.bin:${PATH}"

function cleanup() {
   # crash loop backoff before exec handoff
   sleep 10s
}

trap 'cleanup' EXIT

cd "${WORK_DIR}"

mkdir -p /dev/net /run/openvpn /run/openvpn-client /run/openvpn-server

if [[ ! -c /dev/net/tun ]]; then
	mknod /dev/net/tun c 10 200
fi

/usr/sbin/iptables-legacy -P FORWARD "${IPTABLES_FORWARD_POLICY}"

command="$(command -v node)"
entrypoint="src/init.ts"

if [[ ! -x ${command} ]] || [[ ! -f ${entrypoint} ]]; then
	echo "ERROR: Invalid command \`${command} ${entrypoint}\`"
	exit 1
fi

exec "${command}" "${entrypoint}" "$@"
