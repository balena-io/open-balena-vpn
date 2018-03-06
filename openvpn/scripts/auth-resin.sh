#!/bin/bash

VPN_INSTANCE_ID=$1
if [ -f /usr/src/app/config/env ]; then
	source /usr/src/app/config/env
fi
API_PORT=$((VPN_API_BASE_PORT + VPN_INSTANCE_ID))

RESP=$(curl -s $CURL_EXTRA_FLAGS -H 'Content-type: application/json' -X POST -d '{ "username": "'$username'", "password": "'$password'"}' http://127.0.0.1:${API_PORT}/api/v1/auth/)

# Exiting with 0 status code authorises login.
if [ "$RESP" == "OK" ]; then
	exit 0
else
	exit 1
fi
