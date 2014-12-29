#!/bin/bash
echo '{"event":"client-connect","common_name":"'$common_name'","virtual_address":"'$ifconfig_pool_remote_ip'","real_address":"'$trusted_ip'"}' | tee -a /var/run/openvpn-events.txt
