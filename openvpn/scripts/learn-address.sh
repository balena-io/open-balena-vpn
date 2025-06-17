#!/bin/bash

#shamelessly stolen from https://serverfault.com/questions/701194/limit-throttle-per-user-openvpn-bandwidth-using-tc

#$1 = downrate # from VPN server to the client, e.g. 5mbit
#$2 = uprate # from client to the VPN server, e.g. 5mbit
#$3 = action (add, update, delete)
#$4 = IP or MAC
#$5 = client_common name #Not used for rate limiting

#set -eu

# Configuration with proper defaults
# Convert boolean string to numeric value for script compatibility
LEARN_ADDRESS_DEBUG_VAL=${LEARN_ADDRESS_DEBUG:-false}
if [[ "$LEARN_ADDRESS_DEBUG_VAL" == "true" || "$LEARN_ADDRESS_DEBUG_VAL" == "1" ]]; then
    DEBUG=1
else
    DEBUG=0
fi
statedir=${LEARN_ADDRESS_STATE_DIR:-/var/lib/openvpn/tc-state}
log_dir=${LEARN_ADDRESS_LOG_DIR:-/var/log/openvpn}

# Create directories with proper permissions
mkdir -p "$statedir"
chmod 700 "$statedir"

# Setup logging only if debug is enabled
if [[ $DEBUG -eq 1 ]]; then
    mkdir -p "$log_dir"
    log="$log_dir/learn-address.log"
    # Log with timestamp and rotation consideration
    echo "[$(date -Iseconds)] Starting learn-address script: $# [$@]" >> "$log"
fi

# Validate input parameters
if [[ $# -lt 5 ]]; then
    echo "[ERROR] Insufficient parameters. Expected: downrate uprate action ip cn" >&2
    exit 1
fi

# downrate: from VPN server to the client
downrate=$1
# uprate: from client to the VPN server
uprate=$2

# Validate rate parameters
if [[ ! "$downrate" =~ ^[0-9]+(kbit|mbit|gbit)$ ]] || [[ ! "$uprate" =~ ^[0-9]+(kbit|mbit|gbit)$ ]]; then
    echo "[ERROR] Invalid rate format. Expected format: <number>(kbit|mbit|gbit)" >&2
    exit 1
fi

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

    # Limit traffic from VPN server to client (download)
    if [[ $DEBUG -eq 1 ]]; then
        echo "[$(date -Iseconds)] Adding tc class: dev=$dev classid=1:$classid rate=$downrate" >> "$log"
    fi
    if ! tc class add dev "$dev" parent 1: classid "1:$classid" htb rate "$downrate" 2>/dev/null; then
        echo "[ERROR] Failed to add tc class for client $ip (classid 1:$classid)" >&2
    fi

    if [[ $DEBUG -eq 1 ]]; then
        echo "[$(date -Iseconds)] Adding tc filter: dev=$dev dst=$ip/32 flowid=1:$classid" >> "$log"
    fi
    if ! tc filter add dev "$dev" protocol all parent 1:0 prio 1 u32 match ip dst "$ip/32" flowid "1:$classid" 2>/dev/null; then
        echo "[ERROR] Failed to add tc filter for client $ip destination" >&2
    fi

    # Limit traffic from client to VPN server (upload)
    if [[ $DEBUG -eq 1 ]]; then
        echo "[$(date -Iseconds)] Adding tc ingress filter: dev=$dev src=$ip/32 rate=$uprate" >> "$log"
    fi
    if ! tc filter add dev "$dev" parent ffff: protocol all prio 1 u32 match ip src "$ip/32" police rate "$uprate" burst 80k drop flowid ":$classid" 2>/dev/null; then
        echo "[ERROR] Failed to add tc ingress filter for client $ip" >&2
    fi

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

    # Remove tc rules with proper error handling
    if [[ $DEBUG -eq 1 ]]; then
        echo "[$(date -Iseconds)] Removing tc rules for client $ip (classid $classid)" >> "$log"
    fi

    tc filter del dev "$dev" protocol all parent 1:0 prio 1 u32 match ip dst "$ip/32" 2>/dev/null || true
    tc class del dev "$dev" classid "1:$classid" 2>/dev/null || true
    tc filter del dev "$dev" parent ffff: protocol all prio 1 u32 match ip src "$ip/32" 2>/dev/null || true

    # Remove .dev but keep .classid so it can be reused.
    rm -f "$statedir/$ip.dev"

    post $dev
}

# Make sure queueing discipline is enabled on the device
if [[ -n "$dev" ]]; then
    if [[ $DEBUG -eq 1 ]]; then
        echo "[$(date -Iseconds)] Ensuring tc qdisc setup for device $dev" >> "$log"
    fi
    tc qdisc add dev "$dev" root handle 1: htb 2>/dev/null || true
    tc qdisc add dev "$dev" handle ffff: ingress 2>/dev/null || true
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