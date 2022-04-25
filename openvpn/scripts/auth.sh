#!/bin/bash

# Copyright (C) 2015 Balena Ltd.
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

RESP=$(curl -s $CURL_EXTRA_FLAGS -H 'Content-type: application/json' -X POST -d '{ "username": "'$username'", "password": "'$password'"}' http://127.0.0.1:${VPN_API_PORT}/api/v1/auth/)

# Writing 1 authorizes login.
if [ "$RESP" = "OK" ]; then
	echo 1 > $auth_control_file
else
	echo 0 > $auth_control_file
fi

exit 0
