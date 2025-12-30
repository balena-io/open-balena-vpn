#!/bin/bash

# Get VPN_INSTANCE_COUNT from the environment file that confd already generated
INSTANCE_COUNT=$(grep "^VPN_INSTANCE_COUNT=" /usr/src/app/config/env | cut -d= -f2)
NPROC=$(nproc)

# Handle status paths based on VPN_INSTANCE_COUNT
if [ "$INSTANCE_COUNT" = "0" ]; then
    echo "INSTANCE_COUNT is 0, using NPROC"
		INSTANCE_COUNT=$NPROC
fi

# Build comma-separated list of status files
STATUS_PATHS=""
for (( i=1; i<=INSTANCE_COUNT; i++ )); do
	if [ -n "$STATUS_PATHS" ]; then
			STATUS_PATHS="$STATUS_PATHS,/run/openvpn/server-$i.status"
	else
			STATUS_PATHS="/run/openvpn/server-$i.status"
	fi
done

echo "Waiting for $INSTANCE_COUNT OpenVPN status files..."
MAX_RETRIES=60
for (( retry=0; retry<MAX_RETRIES; retry++ )); do
    PATH_EXISTS=true

    # Check every expected file explicitly since
    # the exporter fails to start if any are missing
    for i in $(seq 1 $INSTANCE_COUNT); do
        if [ ! -f "/run/openvpn/server-$i.status" ]; then
            PATH_EXISTS=false
            break
        fi
    done

    # Execute the openvpn-exporter only if we have status paths to monitor
    if [ "$PATH_EXISTS" = true ]; then
        echo "All status files detected."
        exec /usr/local/bin/openvpn-exporter \
            -openvpn.ignore-individuals "true" \
            -openvpn.listen-address 127.0.0.1:9002 \
            -openvpn.metrics-path /metrics/openvpn \
            -openvpn.status-files "$STATUS_PATHS"
    fi

    sleep 1
done

echo "Timed out waiting for OpenVPN status files."
exit 1
