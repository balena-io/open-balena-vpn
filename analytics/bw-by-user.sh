#!/bin/bash

# Copyright (C) 2016 Balena Ltd.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

cost_per_gb=0.09 # Upto 10TB AWS data usage costs
scale_a_week_to_month=4.285 #30/7
outbound_data_fraction=0.5 #The share of the outbound data in the total data usage.

if [ -z "$LOG_DURATION" ]; then
    echo "Checking Bandwidth for last 7 days as LOG_DURATION variable isnt present"
    LOG_DURATION=7
fi

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

curl --silent "https://api.resin.io/v1/device?\$select=uuid&\$filter=user/username%20eq%20%27$USER%27" \
    -H "Authorization: Bearer $RESIN_AUTH_TOKEN" > tmp_dev_list.json
device_no=$(cat tmp_dev_list.json | jq '.[] | length')
echo "Total devices: $device_no"

touch bw.log
mv bw.log bw.log.bak

for (( c=0; c<$device_no; c++ ))
do
    printf $c.
    uuid=$(cat tmp_dev_list.json | jq -r .d[$c].uuid)
    start=$(date --date="-${LOG_DURATION} day" +%s%3N)
    end=$(date +%s%3N)
    curl -G --silent https://pull.logentries.com/$LOGENTRIES_KEY/hosts/resin-vpn/syslog/ \
        -d start=$start -d end=$end \
        -d filter="/$uuid.*bytes/" >> bw.log
done
echo "Finished pulling logs"
data_usage=$(cat bw.log | awk 'NF' | awk '{print $8}' | awk -F "=" '{print $2}' | sed 's|/0||g' |  awk '{s+=$1}END{print s/(1024*1024*1024)}')
echo "Data usage of $USER in last 7 days: $data_usage GB"
cost=$(echo $data_usage $cost_per_gb $scale_a_week_to_month $outbound_data_fraction | awk '{printf "%.2f \n", $1*$2*$3*$4}')
echo "Approximate cost assuming half the data coming in is billed: USD $cost per month"
echo "AWS charges only transfer out"
