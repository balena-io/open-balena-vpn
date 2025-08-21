#!/usr/bin/env bash

set -e

DEFAULT_SIGTERM_TIMEOUT=$(( ${DEFAULT_SIGTERM_TIMEOUT:-120} * 1000 ))

# These services need custom timeout-kill values based on env vars
for service in haproxy open-balena-vpn dbus avahi-daemon; do
    echo "${DEFAULT_SIGTERM_TIMEOUT}" > /etc/s6-overlay/s6-rc.d/"${service}"/timeout-kill
done

# start s6 overlay
exec /init "${@}"
