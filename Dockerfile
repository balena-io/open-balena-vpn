FROM balena/open-balena-base:v8.0.3 as base


FROM base as builder
COPY package.json package-lock.json /usr/src/app/
RUN npm ci && npm cache clean --force 2>/dev/null
COPY tsconfig.json tsconfig.dev.json /usr/src/app/
COPY typings /usr/src/app/typings
COPY test /usr/src/app/test
COPY src /usr/src/app/src
RUN npm run build


FROM base as main

EXPOSE 80 443 3128

RUN apt-get update -qq \
	&& apt-get install -qy haproxy=1.8.* iptables --no-install-recommends \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/*.list /etc/haproxy/* /etc/openvpn/* /etc/rsyslog.d/49-haproxy.conf \
	&& ln -sf /usr/src/app/openvpn/scripts /etc/openvpn/scripts

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

COPY --from=builder /usr/src/app/build /usr/src/app/build
COPY bin /usr/src/app/bin
COPY config /usr/src/app/config
COPY openvpn /usr/src/app/openvpn

COPY config/services /etc/systemd/system
RUN systemctl enable open-balena-vpn.service
