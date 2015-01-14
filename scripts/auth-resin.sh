#!/bin/bash

if [ -f /etc/openvpn/env ]; then
	source /etc/openvpn/env
fi

URL=https://"${API_HOST:=api.resindev.io}"/services/vpn/auth/"$username"?apikey="$password"
RESP=$(curl "$URL")

# Exiting with 0 status code authorises login.
if [ "$RESP" == "OK" ]; then
	exit 0
else
	exit 1
fi
