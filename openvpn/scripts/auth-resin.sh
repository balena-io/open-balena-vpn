#!/bin/bash

if [ -f /usr/src/app/config/env ]; then
	source /usr/src/app/config/env
fi

RESP=$(curl $CURL_EXTRA_FLAGS -H 'Content-type: application/json' -X POST -d '{ "username": "'$username'", "password": "'$password'"}' http://127.0.0.1/api/v1/auth/)

# Exiting with 0 status code authorises login.
if [ "$RESP" == "OK" ]; then
	exit 0
else
	exit 1
fi
