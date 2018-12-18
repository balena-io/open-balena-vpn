#!/usr/bin/env bash
set -eu

WORK_DIR="$(readlink -e "$(dirname "$0")"/..)"
PATH="${WORK_DIR}/node_modules/.bin:${PATH}"
cd "${WORK_DIR}"

test -f "${WORK_DIR}/config/env" && source "${WORK_DIR}/config/env"

service="$(basename "$0")"
service="${service/balena-/}"
command="$(command -v node)"
entrypoint="build/src/${service}/app.js"
if [ "${NODE_ENV}" = "development" ]; then
	tsnode="$(command -v ts-node || true)"
	if [ -x "${tsnode}" ]; then
		command="${tsnode}"
		entrypoint="src/${service}/app.ts"
	fi
fi

if [ ! -x "${command}" ] || [ ! -f "${entrypoint}" ]; then
	echo "ERROR: Invalid command \`${command} ${entrypoint}\`"
	exit 1
fi

exec "${command}" "${entrypoint}" "$@"
