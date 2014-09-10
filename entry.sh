#!/bin/sh
set -e

touch /etc/openvpn/ipp.txt

[ -d /dev/net ] ||
    mkdir -p /dev/net
[ -c /dev/net/tun ] ||
    mknod /dev/net/tun c 10 200

[ "$1" ] && exec "$@"
