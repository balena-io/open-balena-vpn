#!/bin/bash

# Unassigns a privileged client's IP address, leaving it open for future
# privileged clients to use.

# Adapted from http://sourceforge.net/p/openvpn/mailman/message/28047551/.

# Expects to be passed $ifconfig_pool_remote_ip in $1.
client=$1
timestamp=$(date +"%Y-%m-%d %H:%M:%S")

cache_filename=privileged_assigned.txt
cache_path=/etc/openvpn/$cache_filename
tmp_cache=/tmp/$cache_filename

# Simply strip the IP address from the cache.
grep -v $client $cache_path > $tmp_cache
mv $tmp_cache $cache_path

echo "PRIVILEGED DISCONNECT: $client $timestamp"
