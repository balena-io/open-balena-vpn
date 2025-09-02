#!/usr/bin/env bash

set -e

# Manually run confd once to populate the timeout-kill files
# before starting s6 overlay
/usr/local/bin/confd \
  -onetime \
  -confdir=/usr/src/app/config/confd \
  -backend env

# start s6 overlay
exec /init "${@}"
