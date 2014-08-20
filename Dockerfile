FROM jpetazzo/openvpn:latest
ADD ./config /etc/openvpn
ADD ./entry.sh /entry.sh

EXPOSE 1194
EXPOSE 11194

WORKDIR /etc/openvpn
ENTRYPOINT ["/entry.sh"]
CMD ["openvpn", "server.conf"]
