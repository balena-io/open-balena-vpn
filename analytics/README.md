#Resin VPN Analytics helpers

##Bandwidth consumed by user in last 7 days (bw-by-user.sh)
This script calculates the bandwidth used by user's devices on VPN.

It queries the Resin API for the user's device UUIDs and then uses them to query Logentries VPN logs for strings with the word `bytes` which are emitted on soft-resets of openvpn. We use the byte count in the soft resets to calculate the Bandwidth usage.

###Required environment variables

`RESIN_AUTH_TOKEN` : Auth Token from [https://dashboard.resin.io/preferences?tab=details](https://dashboard.resin.io/preferences?tab=details)

`LOGENTRIES_KEY` : Logentries Account key from [https://logentries.com/app/5915e005#/user-account/profile](https://logentries.com/app/5915e005#/user-account/profile)

`USER` : Resin user you wish to run this script against.
