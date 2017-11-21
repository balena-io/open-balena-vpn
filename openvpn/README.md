# OpenVPN Configuration for Resin VPN

## Common Tasks

*Renewing Certificates*

* Copy the encrypted `ca.key.asc` from resin-ssl/openvpn to this directory
* Run `make renew` in this directory
  * This will ask for the password to decrypt the ca.key.asc
* Commit the results

