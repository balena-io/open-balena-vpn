FROM jpetazzo/openvpn
ADD . /etc/openvpn

EXPOSE 1194
EXPOSE 11194

WORKDIR /etc/openvpn
ENTRYPOINT ["/etc/openvpn/entry.sh"]
CMD ["openvpn", "server.conf"]
