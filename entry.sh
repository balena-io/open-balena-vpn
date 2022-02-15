#!/bin/bash
# Run confd --onetime
confd -onetime -confdir /usr/src/app/config/confd -backend env

# Source env file
set -a
. /usr/src/app/config/env
set +a

# Enable bash job control
set -m

# Start openvpn
/bin/bash -c 'mkdir -p /dev/net; if [ ! -c /dev/net/tun ]; then mknod /dev/net/tun c 10 200; fi' && \
/usr/sbin/iptables-legacy -P FORWARD ${IPTABLES_FORWARD_POLICY} && \
mkdir /var/run/openvpn && \
/usr/src/app/bin/start.sh & \

# Start haproxy
haproxy -f /etc/haproxy/haproxy.cfg & \

# Start node-exporter
/usr/local/bin/node_exporter \
    --web.listen-address 127.0.0.1:9000 \
    --web.telemetry-path /metrics/node \
    --collector.netstat \
    --no-collector.arp \
    --no-collector.bcache \
    --no-collector.bonding \
    --no-collector.conntrack \
    --no-collector.cpu \
    --no-collector.cpufreq \
    --no-collector.diskstats \
    --no-collector.edac \
    --no-collector.entropy \
    --no-collector.filefd \
    --no-collector.filesystem \
    --no-collector.hwmon \
    --no-collector.infiniband \
    --no-collector.ipvs \
    --no-collector.loadavg \
    --no-collector.mdadm \
    --no-collector.meminfo \
    --no-collector.netclass \
    --no-collector.netdev \
    --no-collector.nfs \
    --no-collector.nfsd \
    --no-collector.pressure \
    --no-collector.sockstat \
    --no-collector.stat \
    --no-collector.textfile \
    --no-collector.time \
    --no-collector.timex \
    --no-collector.uname \
    --no-collector.vmstat \
    --no-collector.xfs \
    --no-collector.zfs & \

# Start process-exporter
/usr/local/bin/process-exporter \
    -web.listen-address 127.0.0.1:9001 \
    -web.telemetry-path /metrics/process \
    -procnames haproxy,node,openvpn

# Set first app to foreground
fg %1
