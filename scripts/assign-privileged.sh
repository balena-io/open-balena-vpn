#!/bin/bash

# Assigns privileged clients appropriate IP addresses and push routes for unprivileged clients.
# Adapted from http://sourceforge.net/p/openvpn/mailman/message/28047551/.

ip24=10.255.255
cache_path=/etc/openvpn/privileged_assigned.txt

# We use ifconfig-pool-linear so can ignore windows /30 subnet limitations.
for((i=1;i<256;i+=2)); do
	client=$ip24.$i

	if ! grep -q $client $cache_path; then
		peer=$ip24.$((i+1))
		echo "ifconfig-push $client $peer" > $1
		cat /etc/openvpn/privileged.conf >> $1

		# Add timestamp for debugging and monitoring purposes.
		timestamp=$(date +"%Y-%m-%d %H:%M:%S")
		# Tee to get logging output.
		echo "PRIVILEGED CONNECT: $client $timestamp" | tee -a $cache_path
		exit 0
	fi
done

echo "ERROR: Could not assign a privileged IP address."
