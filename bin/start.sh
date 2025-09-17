#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2154

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

test -f "${WORK_DIR}/config/env" && source "${WORK_DIR}/config/env"

mkdir -p /dev/net /run/openvpn /run/openvpn-client /run/openvpn-server

if [[ ! -c /dev/net/tun ]]; then
	mknod /dev/net/tun c 10 200
fi

/usr/sbin/iptables-legacy -P FORWARD "${IPTABLES_FORWARD_POLICY}"

command="$(command -v node)"
args=("--enable-source-maps")
entrypoint="build/src/app.js"
if [[ ${NODE_ENV} = "development" ]]; then
	args=('--enable-source-maps' '--import @swc-node/register/esm-register')
	entrypoint="src/app.ts"
fi

if [[ ! -x ${command} ]] || [[ ! -f ${entrypoint} ]]; then
	echo "ERROR: Invalid command \`${command} ${entrypoint}\`"
	exit 1
fi

exec "${command}" "${args[@]}" "${entrypoint}" "$@"
