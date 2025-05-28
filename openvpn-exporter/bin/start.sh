#!/bin/bash

# Add a startup delay to give OpenVPN time to create status files
sleep 15

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
for i in $(seq 1 $((INSTANCE_COUNT))); do
	if [ -n "$STATUS_PATHS" ]; then
			STATUS_PATHS="$STATUS_PATHS,/run/openvpn/server-$i.status"
	else
			STATUS_PATHS="/run/openvpn/server-$i.status"
	fi
done

# Execute the openvpn-exporter only if we have status paths to monitor
if [ -n "$STATUS_PATHS" ]; then
    exec /usr/local/bin/openvpn-exporter \
        -openvpn.listen-address 127.0.0.1:9002 \
        -openvpn.metrics-path /metrics/openvpn \
        -openvpn.status-files "$STATUS_PATHS"
else
    echo "No status paths to monitor, exiting"
fi
