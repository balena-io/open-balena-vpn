#!/usr/bin/env bash

set -e

# Ensure k8s/terminationGracePeriodSeconds matches this value!
DEFAULT_SIGTERM_TIMEOUT=$(( ${DEFAULT_SIGTERM_TIMEOUT:-120} * 1000 ))

# These services need custom timeout-kill files to drain gracefully.
# From the s6 documentation: https://skarnet.org/software/s6/servicedir.html
# > An optional regular file named timeout-kill. If such a file exists, it must only contain an unsigned integer t.
# > If t is nonzero, then on receipt of an s6-svc -d command, which sends a SIGTERM (by default, see down-signal below)
# > and a SIGCONT to the service, a timeout of t milliseconds is set; and if the service is still not dead after t milliseconds,
# > then it is sent a SIGKILL. If timeout-kill does not exist, or contains 0 or an invalid value, then the service is never
# > forcibly killed (unless, of course, an s6-svc -k command is sent).
for service in haproxy open-balena-vpn dbus avahi-daemon; do
    echo "${DEFAULT_SIGTERM_TIMEOUT}" > /etc/s6-overlay/s6-rc.d/"${service}"/timeout-kill
done

# start s6 overlay
exec /init "${@}"
