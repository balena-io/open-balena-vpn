#!/bin/bash

#shamelessly stolen from https://serverfault.com/questions/701194/limit-throttle-per-user-openvpn-bandwidth-using-tc

statedir=/tmp/
# downrate: from VPN server to the client
# uprate: from client to the VPN server
downrate=5mbit
uprate=5mbit

function bwlimit-enable() {
    ip=$1

    # Disable if already enabled.
    bwlimit-disable $ip

    # Find unique classid.
    if [ -f $statedir/$ip.classid ]; then
        # Reuse this IP's classid
        classid=`cat $statedir/$ip.classid`
    else
        if [ -f $statedir/last_classid ]; then
            classid=`cat $statedir/last_classid`
            classid=$((classid+1))
        else
            classid=1
        fi
        echo $classid > $statedir/last_classid
    fi

    # Limit traffic from VPN server to client
    tc class add dev $dev parent 1: classid 1:$classid htb rate $downrate
    tc filter add dev $dev protocol all parent 1:0 prio 1 u32 match ip dst $ip/32 flowid 1:$classid

    # Limit traffic from client to VPN server
    tc filter add dev $dev parent ffff: protocol all prio 1 u32 match ip src $ip/32 police rate $uprate burst 80k drop flowid :$classid

    # Store classid and dev for further use.
    echo $classid > $statedir/$ip.classid
    echo $dev > $statedir/$ip.dev
}

function bwlimit-disable() {
    ip=$1

    if [ ! -f $statedir/$ip.classid ]; then
        return
    fi
    if [ ! -f $statedir/$ip.dev ]; then
        return
    fi

    classid=`cat $statedir/$ip.classid`
    dev=`cat $statedir/$ip.dev`

    tc filter del dev $dev protocol all parent 1:0 prio 1 u32 match ip dst $ip/32
    tc class del dev $dev classid 1:$classid

    tc filter del dev $dev parent ffff: protocol all prio 1 u32 match ip src $ip/32

    # Remove .dev but keep .classid so it can be reused.
    rm $statedir/$ip.dev
}

# Make sure queueing discipline is enabled.
tc qdisc add dev $dev root handle 1: htb 2>/dev/null || /bin/true
tc qdisc add dev $dev handle ffff: ingress 2>/dev/null || /bin/true

case "$1" in
    add|update)
        bwlimit-enable $2
        ;;
    delete)
        bwlimit-disable $2
        ;;
    *)
        echo "$0: unknown operation [$1]" >&2
        exit 1
        ;;
esac

exit 0