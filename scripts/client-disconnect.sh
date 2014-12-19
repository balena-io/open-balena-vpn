#!/bin/bash
echo "disconnected" $@ >> /var/log/openvpn-debug/disconnect.log
API_ENDPOINT="https://api.resindev.io"
API_KEY="UAGIApnIbZRUm9CeEYwQbRTV6wYkX0Fy"
curl -s -X POST "$API_ENDPOINT/services/vpn/client-disconnect?apikey=$API_KEY" \
	--data-urlencode "uuid=$common_name" \
	--data-urlencode "vpn_address=$ifconfig_pool_remote_ip" \
	--data-urlencode "remote_ip=$trusted_ip" | \
	tee -a /var/log/openvpn-debug/disconnect.log
