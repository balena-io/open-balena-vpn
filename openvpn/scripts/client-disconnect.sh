#!/bin/bash

# Copyright (C) 2014 Balena Ltd.
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

VPN_INSTANCE_ID=$1
if [ -f /usr/src/app/config/env ]; then
	source /usr/src/app/config/env
fi

curl -s -X DELETE $CURL_EXTRA_FLAGS -H 'Content-type: application/json' -d @- "http://127.0.0.1:${VPN_API_PORT}/api/v2/${VPN_INSTANCE_ID}/clients" >/dev/null <<-EOF || true
{
	"event": "client-disconnect",
	"common_name": "$common_name",
	"bytes_received": $bytes_received,
	"bytes_sent": $bytes_sent,
	"time_duration": $time_duration
}
EOF
