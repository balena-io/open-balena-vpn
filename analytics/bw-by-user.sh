#!/bin/bash

if [ -z "$RESIN_AUTH_TOKEN" ]; then
    echo "Need to set RESIN_AUTH_TOKEN"
    exit 1
fi

if [ -z "$LOGENTRIES_KEY" ]; then
    echo "Need to set LOGENTRIES_KEY"
    exit 1
fi

if [ -z "$USER" ]; then
    echo "Need to set USER"
    exit 1
fi

curl --silent "https://api.resin.io/ewa/device?\$select=uuid&\$filter=user/username%20eq%20%27$USER%27" \
    -H "Authorization: Bearer $RESIN_AUTH_TOKEN" > tmp_dev_list.json
device_no=$(cat tmp_dev_list.json | jq '.[] | length')
echo "Total devices: $device_no"

touch bw.log
mv bw.log bw.log.bak

for (( c=0; c<$device_no; c++ ))
do
    printf $c.
    uuid=$(cat tmp_dev_list.json | jq -r .d[$c].uuid)
    start=$(date --date='-7 day' +%s%3N)
    end=$(date +%s%3N)
    curl -G --silent https://pull.logentries.com/$LOGENTRIES_KEY/hosts/resin-vpn/syslog/ \
        -d start=$start -d end=$end \
        -d filter="/$uuid.*bytes/" >> bw.log
done
echo "Finished pulling logs"
data_usage=$(cat bw.log | awk 'NF' | awk '{print $8}' | awk -F "=" '{print $2}' | sed 's|/0||g' |  awk '{s+=$1}END{print s/(1024*1024*1024)}')
echo "Data usage of $USER in last 7 days: $data_usage GB"
cost=$(echo $data_usage | awk '{printf "%.2f \n", $1*0.09*.5*4.28}')
echo "Approximate cost assuming half the data coming in is billed: USD $cost per month"
echo "AWS charges only transfer out"
