#!/usr/bin/env bash

set -e

# Resolve the openvpn instance count once, for haproxy, the app and openvpn-exporter.
# An explicit positive VPN_INSTANCE_COUNT wins.
# Non-production mode uses 1 instance.
# Production mode uses the pod CPU request if present, else the CPUs available to the container.
pod_cpu_request=/etc/podinfo/cpu_request
count_source=VPN_INSTANCE_COUNT
if [[ ${VPN_INSTANCE_COUNT:-0} == 0 ]]; then
	if [[ ${PRODUCTION_MODE} != true ]]; then
		VPN_INSTANCE_COUNT=1
	elif [[ -f ${pod_cpu_request} ]]; then
		count_source=${pod_cpu_request}
		VPN_INSTANCE_COUNT="$(<"${pod_cpu_request}")"
	else
		VPN_INSTANCE_COUNT="$(nproc)"
	fi
fi
if [[ ! ${VPN_INSTANCE_COUNT} =~ ^[1-9][0-9]*$ ]]; then
	echo "${count_source} is not a positive integer: '${VPN_INSTANCE_COUNT}'" >&2
	exit 1
fi
export VPN_INSTANCE_COUNT

# start s6 overlay via the base image init script
exec /etc/s6-overlay/scripts/s6-init "${@}"
