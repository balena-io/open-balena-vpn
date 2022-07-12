FROM balena/open-balena-base:v13.4.0 as base


FROM base as builder
COPY package.json package-lock.json /usr/src/app/
RUN npm ci && npm cache clean --force 2>/dev/null
COPY tsconfig.json tsconfig.dev.json /usr/src/app/
COPY typings /usr/src/app/typings
COPY test /usr/src/app/test
COPY src /usr/src/app/src
RUN npm run build

FROM base as plugin-builder

RUN apt-get update \
	&& apt-get install \
		libssl-dev \
		openvpn \
	&& rm -rf /var/lib/apt/lists/*

FROM plugin-builder as connect-disconnect-plugin

ENV CONNECT_DISCONNECT_PLUGIN_COMMIT=7c958d8b33a87a06b5a8fa096397fc623494013a
RUN git clone https://github.com/balena-io-modules/connect-disconnect-script-openvpn.git \
	&& cd connect-disconnect-script-openvpn \
	&& git checkout ${CONNECT_DISCONNECT_PLUGIN_COMMIT} \
	&& C_INCLUDE_PATH=/usr/include/openvpn/ make plugin

FROM plugin-builder as auth-plugin

ENV AUTH_PLUGIN_COMMIT=623982a5d63dd2b7b2b9f9295d10d96a56d58894
RUN git clone https://github.com/fac/auth-script-openvpn.git \
	&& cd auth-script-openvpn \
	&& git checkout ${AUTH_PLUGIN_COMMIT} \
	&& C_INCLUDE_PATH=/usr/include/openvpn/ make plugin

FROM rust:1-bullseye as rust-builder

WORKDIR /usr/src/app
COPY auth .
RUN cargo build --release

FROM base as main

# Docker/systemd socialisation hack to handle SIGTERM=>SIGKILL
# https://stackoverflow.com/q/43486361/1559300
# https://bugzilla.redhat.com/show_bug.cgi?id=1201657
# https://unix.stackexchange.com/a/572819/78029
# https://engineeringblog.yelp.com/2016/01/dumb-init-an-init-for-docker.html
STOPSIGNAL SIGRTMIN+3

EXPOSE 80 443 3128

RUN apt-get update && apt-get install -y --no-install-recommends \
    socat \
    && rm -rf /var/lib/apt/lists/*

RUN curl -s https://haproxy.debian.net/bernat.debian.org.gpg | apt-key add - >/dev/null \
    && echo deb http://haproxy.debian.net bullseye-backports-2.6 main > /etc/apt/sources.list.d/haproxy.list \
    && apt-get update -qq \
    && apt-get install -qy haproxy=2.6.* iptables --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/*.list /etc/haproxy/* /etc/rsyslog.d/49-haproxy.conf /etc/openvpn/* /etc/defaults/openvpn \
    && ln -sf /usr/src/app/openvpn/scripts /etc/openvpn/scripts \
    && systemctl mask openvpn@.service openvpn.service

ENV LIBNSS_OPENVPN_VERSION 22feb11322182f6fd79f85cd014b65b6c40b7b47
RUN tmp="$(mktemp -d)" set -x \
    && git clone -q https://github.com/balena-io-modules/libnss-openvpn.git "${tmp}" \
    && cd "${tmp}" \
    && git -C "${tmp}" checkout -q ${LIBNSS_OPENVPN_VERSION} \
    && make -C "${tmp}" -j "$(nproc)" \
    && make -C "${tmp}" install \
    && sed --in-place --regexp-extended 's|(hosts:\W+)(.*)|\1openvpn \2|' /etc/nsswitch.conf \
    && rm -rf "${tmp}"

ENV NODE_EXPORTER_VERSION 1.3.1
ENV NODE_EXPORTER_SHA256SUM 68f3802c2dd3980667e4ba65ea2e1fb03f4a4ba026cca375f15a0390ff850949
RUN NODE_EXPORTER_TGZ="/tmp/node_exporter.tar.gz" set -x \
    && curl -Lo "${NODE_EXPORTER_TGZ}" https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz \
    && echo "${NODE_EXPORTER_SHA256SUM}  ${NODE_EXPORTER_TGZ}" | sha256sum -c \
    && tar -xzC /usr/local/bin -f "${NODE_EXPORTER_TGZ}" --strip-components=1 --wildcards '*/node_exporter' \
    && rm "${NODE_EXPORTER_TGZ}"

ENV PROCESS_EXPORTER_VERSION 0.7.10
ENV PROCESS_EXPORTER_SHA256SUM 52503649649c0be00e74e8347c504574582b95ad428ff13172d658e82b3da1b5
RUN PROCESS_EXPORTER_TGZ="/tmp/process_exporter.tar.gz" set -x \
    && curl -Lo "${PROCESS_EXPORTER_TGZ}" https://github.com/ncabatoff/process-exporter/releases/download/v${PROCESS_EXPORTER_VERSION}/process-exporter-${PROCESS_EXPORTER_VERSION}.linux-amd64.tar.gz \
    && echo "${PROCESS_EXPORTER_SHA256SUM}  ${PROCESS_EXPORTER_TGZ}" | sha256sum -c \
    && tar -xzC /usr/local/bin -f "${PROCESS_EXPORTER_TGZ}" --strip-components=1 --wildcards '*/process-exporter' \
    && rm "${PROCESS_EXPORTER_TGZ}"

COPY package.json package-lock.json /usr/src/app/
RUN npm ci --unsafe-perm --production && npm cache clean --force 2>/dev/null

COPY --from=auth-plugin /usr/src/app/auth-script-openvpn/openvpn-plugin-auth-script.so /etc/openvpn/plugins/
COPY --from=builder /usr/src/app/build /usr/src/app/build
COPY --from=connect-disconnect-plugin /usr/src/app/connect-disconnect-script-openvpn/openvpn-plugin-connect-disconnect-script.so /etc/openvpn/plugins/
COPY --from=rust-builder /usr/src/app/target/release/auth /usr/src/app/openvpn/scripts/auth
COPY bin /usr/src/app/bin
COPY config /usr/src/app/config
COPY openvpn /usr/src/app/openvpn
COPY docker-hc /usr/src/app/
COPY config/services /etc/systemd/system
RUN systemctl enable \
    open-balena-vpn.service \
    node-exporter.service \
    process-exporter.service
