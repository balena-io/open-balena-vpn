#!/bin/bash

#shamelessly stolen from https://serverfault.com/questions/701194/limit-throttle-per-user-openvpn-bandwidth-using-tc

#$1 = downrate # from VPN server to the client, e.g. 5mbit
#$2 = uprate # from client to the VPN server, e.g. 5mbit
#$3 = action (add, update, delete)
#$4 = IP or MAC
#$5 = client_common name #Not used for rate limiting

#set -eu

DEBUG=0
statedir=/tmp/learn-address/
mkdir -p $statedir

if [[ $DEBUG -eq 1 ]]; then 
    log=$statedir/status.log
    touch $log
    echo "****************" &>> $log
    echo "Starting $0: $# [$@]" &>> $log
fi

# downrate: from VPN server to the client
downrate=$1
# uprate: from client to the VPN server
uprate=$2

function trace() {
    if [[ $DEBUG -eq 1 ]]; then 
        place=$1
        dev=$2
        echo "*** $place" &>> $log
        if [[ $dev ]]; then
            echo "tc -s qdisc show dev $dev" &>> $log 
            tc -s qdisc show dev $dev &>> $log 
            echo "tc -s class show dev $dev" &>> $log 
            tc -s class show dev $detv &>> $log 
            echo "tc -s filter show dev $dev" &>> $log 
            tc -s class show dev $dev &>> $log 
        else 
            echo "No dev!" &>> $log
        fi
        echo "***" &>> $log
    fi
}

function pre() {
    trace "PRE" $1
}

function post() {
    trace "POST" $1
}

function bwlimit-enable() {
    ip=$1

    pre $dev

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
    echo "tc class add dev $dev parent 1: classid 1:$classid htb rate $downrate" &>> $log
    tc class add dev $dev parent 1: classid 1:$classid htb rate $downrate &>> $log
    echo "tc filter add dev $dev protocol all parent 1:0 prio 1 u32 match ip dst $ip/32 flowid 1:$classid" &>> $log
    tc filter add dev $dev protocol all parent 1:0 prio 1 u32 match ip dst $ip/32 flowid 1:$classid &>> $log

    # Limit traffic from client to VPN server
    tc filter add dev $dev parent ffff: protocol all prio 1 u32 match ip src $ip/32 police rate $uprate burst 80k drop flowid :$classid &>> $log
    echo "tc filter add dev $dev parent ffff: protocol all prio 1 u32 match ip src $ip/32 police rate $uprate burst 80k drop flowid :$classid" &>> $log
    
    # Store classid and dev for further use.
    echo $classid > $statedir/$ip.classid
    echo $dev > $statedir/$ip.dev

    post $dev
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

    pre $dev

    tc filter del dev $dev protocol all parent 1:0 prio 1 u32 match ip dst $ip/32
    tc class del dev $dev classid 1:$classid

    tc filter del dev $dev parent ffff: protocol all prio 1 u32 match ip src $ip/32

    # Remove .dev but keep .classid so it can be reused.
    rm $statedir/$ip.dev

    post $dev
}

if [[ $dev ]]; then
    # Make sure queueing discipline is enabled.
    tc qdisc add dev $dev root handle 1: htb 2>/dev/null || /bin/true
    tc qdisc add dev $dev handle ffff: ingress 2>/dev/null || /bin/true
fi

case "$3" in
    add|update)
        bwlimit-enable $4
        ;;
    delete)
        bwlimit-disable $4
        ;;
    *)
        echo "$0: unknown operation [$3]" >&2
        exit 1
        ;;
esac
exit 0