#!/bin/bash

if [ -f /usr/src/app/config/env ]; then
	source /usr/src/app/config/env
fi

URL=https://"${RESIN_API_HOST:=api.resindev.io}"/services/vpn/auth/"$username"?apikey="$password"
RESP=$(curl $CURL_EXTRA_FLAGS "$URL")

# Exiting with 0 status code authorises login.
if [ "$RESP" == "OK" ]; then
	exit 0
else
	exit 1
fi
