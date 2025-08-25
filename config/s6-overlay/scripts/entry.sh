#!/usr/bin/env bash

# Update s6 kill gracetime to match default sigterm timeout
S6_KILL_GRACETIME="${DEFAULT_SIGTERM_TIMEOUT:-120}"
export S6_KILL_GRACETIME

# start s6 overlay
exec /init "${@}"
