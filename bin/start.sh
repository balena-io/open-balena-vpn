#!/usr/bin/env bash
set -eu

WORK_DIR="$(readlink -e "$(dirname "$0")"/..)"
PATH="${WORK_DIR}/node_modules/.bin:${PATH}"
cd "${WORK_DIR}"

# shellcheck disable=1090
test -f "${WORK_DIR}/config/env" && source "${WORK_DIR}/config/env"

command="$(command -v node)"
args=("-r" "source-map-support/register")
entrypoint="build/src/app.js"
if [ "${NODE_ENV}" = "development" ]; then
	tsnode="$(command -v ts-node || true)"
	if [ -x "${tsnode}" ]; then
		command="${tsnode}"
		args=("--files")
		entrypoint="src/app.ts"
	fi
fi

if [ ! -x "${command}" ] || [ ! -f "${entrypoint}" ]; then
	echo "ERROR: Invalid command \`${command} ${entrypoint}\`"
	exit 1
fi

exec "${command}" "${args[@]}" "${entrypoint}" "$@"
