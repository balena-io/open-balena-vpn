#!/bin/bash
echo '{"event":"client-connect","uuid":"'$common_name'","vpn_address":"'$ifconfig_pool_remote_ip'","remote_ip":"'$trusted_ip'"}' | tee -a /var/run/openvpn-events.txt
