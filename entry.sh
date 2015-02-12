#!/bin/bash
set -e

#--- Pull configuration from etcd into /etc/openvpn/env (see config/env.*)

if nc -z -w 4 172.17.42.1 4001;
then
	/usr/local/bin/confd -verbose -onetime -node 'http://172.17.42.1:4001' -confdir=/etc/confd
fi

#--- Source environment variables

if [ -f /etc/openvpn/env ];
then
    source /etc/openvpn/env
fi

export LOGENTRIES_ACCOUNT_KEY=${LOGENTRIES_ACCOUNT_KEY:=}
export API_ENDPOINT=${API_ENDPOINT:=https://api.resindev.io}
export API_KEY=${API_KEY:=UAGIApnIbZRUm9CeEYwQbRTV6wYkX0Fy}
export VPN_MANAGEMENT_PORT=${VPN_MANAGEMENT_PORT:=11194}
export VPN_MANAGEMENT_NEW_PORT=${VPN_MANAGEMENT_NEW_PORT:=11195}
export VPN_HOST=${VPN_HOST:=127.0.0.1}
export VPN_SUBNET_8=${VPN_SUBNET_8:=10}
export API_VPN_IP=${API_VPN_IP:=10.255.255.1}

# Prevent client devices from communicating with one another.

# Allow already established connections.
iptables -A FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
# Allow communication between 10.255.255.1 and 10.{1,2}.0.0/16, only if initiated by 10.255.255.1.
iptables -A FORWARD -s 10.255.255.0/24 -d 10.1.0.0/16 -m conntrack --ctstate NEW -j ACCEPT
iptables -A FORWARD -s 10.255.255.0/24 -d 10.2.0.0/16 -m conntrack --ctstate NEW -j ACCEPT

# Deny everything else.
iptables -A FORWARD -j DROP

touch /etc/openvpn/ipp.txt
touch /etc/openvpn/ipp_legacy.txt

/usr/bin/supervisord -c /etc/supervisor/supervisord.conf

[ -d /dev/net ] ||
    mkdir -p /dev/net
[ -c /dev/net/tun ] ||
    mknod /dev/net/tun c 10 200

supervisorctl start resin-vpn
supervisorctl start resin-vpn-legacy

# Tests start vpn-api server manually
if [ -z "$VPN_TESTING" ]; then
	supervisorctl start resin-vpn-api
fi

#--- Start Logentries daemon
if [ $LOGENTRIES_ACCOUNT_KEY ]; then
    #--- HOTFIX: Logentries fails to register, disable exit on error
    set +o errexit

    /usr/bin/le init --account-key=${LOGENTRIES_ACCOUNT_KEY}
    /usr/bin/le register --name=VPN
    /usr/bin/le follow '/resin-log/resin_vpn_stdout.log' --name=VPN_LOGS_STDOUT
    /usr/bin/le follow '/resin-log/resin_vpn_error.log' --name=VPN_LOGS_ERROR
    /usr/bin/le follow '/resin-log/resin_vpn_legacy_stdout.log' --name=VPN_LOGS_STDOUT
    /usr/bin/le follow '/resin-log/resin_vpn_legacy_error.log' --name=VPN_LOGS_ERROR

    service logentries start
fi

[ "$1" ] && exec "$@"
