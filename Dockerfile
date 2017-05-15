FROM resin/resin-base:v2.9.2

EXPOSE 80 443

RUN echo deb http://deb.debian.org/debian jessie-backports main > /etc/apt/sources.list.d/backports.list \
	&& apt-get update -qq \
	&& apt-get install -qy openssl openvpn haproxy sipcalc -t jessie-backports --no-install-recommends \
	&& apt-get clean && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/backports.list /etc/haproxy/*

ENV LIBNSS_OPENVPN_VERSION 59d24ac3a392772cbdb05f4f47f425a741cd7f77
RUN tmp="$(mktemp -d)" set -x \
	&& git clone -q https://github.com/resin-io-modules/libnss-openvpn.git "${tmp}" \
	&& cd "${tmp}" \
	&& git -C "${tmp}" checkout -q ${LIBNSS_OPENVPN_VERSION} \
	&& make -C "${tmp}" -j "$(nproc)" \
	&& make -C "${tmp}" install \
	&& sed --in-place --regexp-extended 's|(hosts:.*)|\1 openvpn|' /etc/nsswitch.conf \
	&& rm -rf "${tmp}"

RUN echo "AUTOSTART=none" > /etc/default/openvpn \
	&& rm -rf /etc/openvpn && ln -s /usr/src/app/openvpn /etc/openvpn

COPY package.json /usr/src/app/
RUN npm install --unsafe-perm --production && npm cache clean
COPY . /usr/src/app

COPY config/services /etc/systemd/system
RUN systemctl enable resin-vpn.service resin-connect-proxy.service
