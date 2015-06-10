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
