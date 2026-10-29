#!/usr/bin/env bash

set -e

# Count of processors, used by the haproxy and env config templates.
NPROC="$(nproc)"
export NPROC

# start s6 overlay via the base image init script
exec /etc/s6-overlay/scripts/s6-init "${@}"
