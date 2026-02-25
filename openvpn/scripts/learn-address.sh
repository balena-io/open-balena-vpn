#!/bin/bash

#shamelessly stolen from https://serverfault.com/questions/701194/limit-throttle-per-user-openvpn-bandwidth-using-tc

#$1 = downrate # from VPN server to the client, e.g. 5mbit
#$2 = uprate # from client to the VPN server, e.g. 5mbit
#$3 = action (add, update, delete)
#$4 = IP or MAC
#$5 = client_common name #Not used for rate limiting
#$6 = device name (e.g. tun1, tun2, etc.)

#set -eu

# Validate the required number of arguments for add vs. delete
if [[ "$3" == "delete" ]]; then
    if [[ $# -lt 4 ]]; then
        echo "[ERROR] Insufficient parameters for delete. Expected: downrate uprate delete ip" >&2
        exit 1
    fi
elif [[ $# -lt 5 ]]; then
    echo "[ERROR] Insufficient parameters for add/update. Expected: downrate uprate action ip cn" >&2
    exit 1
fi

# downrate: from VPN server to the client
downrate=$1
# uprate: from client to the VPN server
uprate=$2
action=$3
ip=$4
# $5 is the common name (cn), which is not used in the script's logic

# Initialize defaults
# Set dev from the environment variable provided by OpenVPN as a fallback.
dev=${dev:-}
DEBUG=0

# Loop through all arguments to find our optional flags.
for arg in "$@"; do
    if [[ "$arg" == "debug" ]]; then
        DEBUG=1
    # If an argument looks like a tun/tap device or is 'lo' for testing, use it.
    elif [[ "$arg" == tun* || "$arg" == tap* || "$arg" == "lo" ]]; then
        dev="$arg"
    fi
done

# Final validation to ensure we have a device name for add/update actions.
if [[ "$action" != "delete" && -z "$dev" ]]; then
    echo "[ERROR] No device specified for action '$action'. Could not find in arguments or environment." >&2
    exit 1
fi

# Validate rate parameters
if [[ ! "$downrate" =~ ^[0-9]+(kbit|mbit|gbit)$ ]] || [[ ! "$uprate" =~ ^[0-9]+(kbit|mbit|gbit)$ ]]; then
    echo "[ERROR] Invalid rate format. Expected format: <number>(kbit|mbit|gbit)" >&2
    exit 1
fi

# Setup logging only if debug is enabled
if [[ $DEBUG -eq 1 ]]; then
    log_dir=${LEARN_ADDRESS_LOG_DIR:-/var/log/openvpn}
    mkdir -p "$log_dir"
    log="$log_dir/learn-address.log"
    echo "[$(date -Iseconds)] Starting learn-address script: $# [$*]" >> "$log"
fi
statedir=${LEARN_ADDRESS_STATE_DIR:-/var/lib/openvpn/tc-state}

# Create directories with proper permissions
mkdir -p "$statedir"
chmod 700 "$statedir"

function trace() {
    # This function takes the calling location (e.g., "PRE-") as its first
    # argument and the device name as its second.
    if [[ $DEBUG -eq 1 ]]; then
        local place="$1"
        local device="$2"
        echo "*** $place ***" >> "$log"
        if [[ -n "$device" ]]; then
            echo "--- qdisc for $device ---" >> "$log"
            tc -s qdisc show dev "$device" >> "$log" 2>&1
            echo "--- class for $device ---" >> "$log"
            tc -s class show dev "$device" >> "$log" 2>&1
        else
            echo "No device specified for trace." >> "$log"
        fi
        echo "****************" >> "$log"
    fi
}

function compute_classid() {
    # Compute unique classid from IP address (last 2 octets)
    # This ensures deterministic mapping from IP to classid
    local ip=$1
    IFS='.' read -r oct1 oct2 oct3 oct4 <<< "$ip"
    echo $(( (oct3 * 256 + oct4) % 65534 + 1 ))
}

function bwlimit-enable() {
    ip=$1

    trace "PRE-ENABLE" "$dev"

    # Disable if already enabled.
    bwlimit-disable $ip

    classid=$(compute_classid "$ip")

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

    echo $dev > $statedir/$ip.dev

    trace "POST-ENABLE" "$dev"
}

function bwlimit-disable() {
    ip=$1

    if [ ! -f $statedir/$ip.dev ]; then
        return
    fi

    classid=$(compute_classid "$ip")

    local dev_from_state
    dev_from_state=$(cat "$statedir/$ip.dev")

    trace "PRE-DISABLE" "$dev_from_state"

    # Remove tc rules with proper error handling
    if [[ $DEBUG -eq 1 ]]; then
        echo "[$(date -Iseconds)] Removing tc rules for client $ip (classid $classid)" >> "$log"
    fi

    tc filter del dev "$dev_from_state" protocol all parent 1:0 prio 1 u32 match ip dst "$ip/32" 2>/dev/null || true
    tc class del dev "$dev_from_state" classid "1:$classid" 2>/dev/null || true
    tc filter del dev "$dev_from_state" parent ffff: protocol all prio 1 u32 match ip src "$ip/32" 2>/dev/null || true

    rm -f "$statedir/$ip.dev"

    trace "POST-DISABLE" "$dev_from_state"
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
