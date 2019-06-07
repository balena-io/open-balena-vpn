FROM balena/open-balena-base:v7.2.1 as base

EXPOSE 80 443 3128

RUN curl -s https://haproxy.debian.net/bernat.debian.org.gpg | apt-key add - >/dev/null \
	&& echo deb http://haproxy.debian.net stretch-backports-1.8 main > /etc/apt/sources.list.d/haproxy.list \
	&& apt-get update -qq \
	&& apt-get install -qy openssl openvpn sipcalc socat --no-install-recommends \
	&& apt-get install -qy haproxy=1.8.* -t stretch-backports-1.8 --no-install-recommends \
	&& apt-get clean && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/*.list /etc/haproxy/* /etc/openvpn/* /etc/rsyslog.d/49-haproxy.conf

ENV LIBNSS_OPENVPN_VERSION 22feb11322182f6fd79f85cd014b65b6c40b7b47
RUN tmp="$(mktemp -d)" set -x \
	&& git clone -q https://github.com/balena-io-modules/libnss-openvpn.git "${tmp}" \
	&& cd "${tmp}" \
	&& git -C "${tmp}" checkout -q ${LIBNSS_OPENVPN_VERSION} \
	&& make -C "${tmp}" -j "$(nproc)" \
	&& make -C "${tmp}" install \
	&& sed --in-place --regexp-extended 's|(hosts:.*)|\1 openvpn|' /etc/nsswitch.conf \
	&& rm -rf "${tmp}"

COPY package.json package-lock.json /usr/src/app/
RUN npm ci --unsafe-perm --production && npm cache clean --force 2>/dev/null
COPY . /usr/src/app

COPY openvpn /etc/openvpn
COPY config/services /etc/systemd/system
RUN systemctl enable open-balena-vpn-api.service open-balena-connect-proxy.service

# build test image
FROM base as test
RUN npm ci && npm cache clean --force 2>/dev/null
ENV BALENA_API_HOST api.balena.test
RUN npm run check && npm run test-unit

# build and export production image
FROM base as main
RUN npm run build
