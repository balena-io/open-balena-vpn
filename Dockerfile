FROM jpetazzo/openvpn
ADD ./openvpn/config /etc/openvpn
ADD ./openvpn/entry.sh /entry.sh

EXPOSE 1194
EXPOSE 11194

WORKDIR /etc/openvpn
ENTRYPOINT ["/entry.sh"]
CMD ["openvpn", "server.conf"]
