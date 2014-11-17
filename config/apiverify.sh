#!/bin/bash
if [ -f /etc/openvpn/env ];
then
    source /etc/openvpn/env
fi
export API_HOST=${API_HOST:=}
if [ $API_HOST ]; then
    export AUTH_CHECK=$(curl https://$API_HOST/services/vpn/auth/$username?apikey=$password)
else
    export AUTH_CHECK=$(curl http://api.resindev.io/services/vpn/auth/$username?apikey=$password)
fi
if [ "$AUTH_CHECK" == "OK" ]; then
    exit 0 # exit 0 to accept auth
fi
exit 1 # exit 1 to deny auth

