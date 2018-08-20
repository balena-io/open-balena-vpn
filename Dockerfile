FROM resin/resin-base:v4.2.1

EXPOSE 80 443

RUN curl -s https://haproxy.debian.net/bernat.debian.org.gpg | apt-key add - >/dev/null \
	&& echo deb http://haproxy.debian.net stretch-backports-1.8 main > /etc/apt/sources.list.d/haproxy.list \
	&& apt-get update -qq \
	&& apt-get install -qy openssl openvpn sipcalc socat --no-install-recommends \
	&& apt-get install -qy haproxy=1.8.* -t stretch-backports-1.8 --no-install-recommends \
	&& apt-get clean && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/*.list /etc/haproxy/* /etc/rsyslog.d/49-haproxy.conf

ENV LIBNSS_OPENVPN_VERSION 22feb11322182f6fd79f85cd014b65b6c40b7b47
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

COPY package.json package-lock.json /usr/src/app/
RUN npm install --unsafe-perm --production && npm cache clean --force 2>/dev/null
COPY . /usr/src/app
RUN npm run check

COPY config/services /etc/systemd/system
RUN systemctl enable resin-vpn.service resin-connect-proxy.service
