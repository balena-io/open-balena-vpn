* Remove legacy activePort so that resin-vpn can safely be restarted. [Internal] [Aleksis]
* Use resin-lint [Internal] [Kostas]
* Remove device port 4200 from web access whitelist [External] [Kostas]
* Updated dependencies [Internal] [Page]
* Reduce noise in logs [Internal] [Kostas]
* Always restart resin-vpn.service if process exits or is killed. [Internal] [Kostas]

# 2016-01-20

* Wait a while after starting VPN to do the reset-all, to reduce the number of devices that appear offline during the mass reconnect. [Internal] [Page]
* Fixed client events http status code check. [Internal] [Aleksis]
* Update pinejs-client to include the escaping fix. [Internal] [Page]
* Updated to the new resin-base. [Internal] [Page]

# 2015-01-05

* Use the uuid to connect to the device, rather than relying on the api reported vpn_address which may be incorrect. [Internal] [Page]

# 2015-12-01

* Updated the vpn server certificate for another two years, to `Nov 23 16:10:32 2017 GMT` [Internal] [Page]
* Switched to a purely etcd backed confd. [Internal] [Page]
* Updated resin-base to include nodejs v4. [Internal] [Page]
* Removed reverse-proxy as it's going to continue living in resin-proxy with fixes. [Internal] [Page]

# 2015-11-12

* Allow connecting to devices via uuid rather than ip, using `${uuid}.vpn` [Internal] [Page]
* Fix the grammar of the proxy error pages. [Page]

# 2015-10-01

* Added winston logging module and improved logging on tunnel requests.
* Fixed an rsyslogd infinite restart loop when there is no logentries token. [Page]

# 2015-08-17

* Use JWT to authenticate requests from the API. [Aleksis]
* Try to populate the docker cache before building. [Page]
* Switched to using a tagged version of resin-base. [Page]

# 2015-07-26

* Added a /ping endpoint. [Aleksis]
* Switched to http/1.0 for the reverse proxy - necessary for some nc versions (eg OSX). [Aleksis]
* Always used the short commit hash for tagging. [Petros]
* Improved test script. [Aleksis]
* Switched logentries to TLS. [Petros]
* Switched to using some published modules. [Aleksis]
* Added VPN reverse proxy. [Aleksis]
* Report additional data on auth fail. [Lorenzo]

# 2015-07-17

* Changed to support newer resin-base with confd 0.10.0 [Page]
* Added VPN proxy. [Aleksis]
* Cleaned up openvpn-nc. [Aleksis]
* Disable autogeneration of openvpn services. [Petros]

# 2015-06-10

* Fix reset-all error handler [Aleksis]
* Fix VPN race condition causing incorrect online/offline state [petrosagg]
* Use less aggressive keepalive settings [petrosagg]

# 2015-05-13

v0.1.1
* Request API to reset all clients state when VPN starts and on event message failure. [Aleksis]
* Fix race condition of /dev/net/tun device node creation [petrosagg]
* Fix typo in client authentication [Page]

v0.1.0
* Switched to using resin-base. [Aleksis]
* Improved tests and made them able to be run by jenkins. [Aleksis]
