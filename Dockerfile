FROM resin/resin-closed-base:1

EXPOSE 80 443

ENV LIBNSSS_OPENVPN_VERSION=964ef26430878978ac0bfb379454fe05e52686b7
RUN git clone https://github.com/resin-io-modules/libnss-openvpn.git \
	&& cd libnss-openvpn \
	&& git checkout ${LIBNSSS_OPENVPN_VERSION} \
	&& sed --in-place 's|OPENVPN_STATUS_FILE "/var/run/openvpn.server.status"|OPENVPN_STATUS_FILE "/var/run/openvpn/server.status"|' libnss_openvpn.c \
	&& make \
	&& make install \
	&& sed --in-place --regexp-extended 's|(hosts:.*)|\1 openvpn|' /etc/nsswitch.conf

COPY package.json /usr/src/app/
RUN npm install --unsafe-perm --production && npm cache clean

COPY . /usr/src/app

COPY config/services/ /etc/systemd/system/

RUN echo AUTOSTART=none > /etc/default/openvpn \
	&& rm -rf /etc/openvpn \
	&& ln -s /usr/src/app/openvpn /etc/openvpn

RUN systemctl enable resin-vpn.service resin-connect-proxy.service
