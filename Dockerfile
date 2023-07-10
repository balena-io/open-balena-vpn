FROM balena/open-balena-base:v15.0.0 as base


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

FROM rust:1-bookworm as rust-builder

WORKDIR /usr/src/app
COPY auth .
RUN cargo build --release

FROM base as main

ARG TARGETARCH

ARG EGET_RELEASE=1.3.3
ARG EGET_SHA256_arm=8b13bc2dbf72a6a0ea2619663e9e5e55f74787459a88a89ebdbd390135d3b836
ARG EGET_SHA256_arm64=276d58ec76178be131fb920f3a7dea2e4603a3746c77350d9d3deffa2f5143a2
ARG EGET_SHA256_amd64=373a3bf0864344bfae684b575f01e9c4759b0aa7091dd9c325a3a373cf437d38

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN asset="eget-${EGET_RELEASE}-linux_${TARGETARCH:-amd64}.tar.gz" && \
	sha256="EGET_SHA256_${TARGETARCH:-amd64}" && \
	curl -fsSL -O "https://github.com/zyedidia/eget/releases/download/v${EGET_RELEASE}/${asset}" && \
	echo "${!sha256} ${asset}" | sha256sum -c - && \
	tar -xzv -C /usr/local/bin -f "${asset}" --strip-components=1 --wildcards '*/eget' && \
	rm "${asset}" && \
	chmod +x /usr/local/bin/eget

COPY eget_${TARGETARCH:-amd64}.toml /root/.eget.toml

ARG NODE_EXPORTER_TAG=v1.3.1
ARG PROCESS_EXPORTER_TAG=v0.7.10

RUN eget prometheus/node_exporter --tag ${NODE_EXPORTER_TAG} \
	&& eget ncabatoff/process-exporter --tag ${PROCESS_EXPORTER_TAG}

EXPOSE 80 443 3128

RUN apt-get update && apt-get install -y --no-install-recommends \
	socat \
	&& rm -rf /var/lib/apt/lists/*

# https://docs.renovatebot.com/modules/datasource/repology/
# renovate: datasource=repology depName=debian_12/haproxy versioning=loose
ARG HAPROXY_VERSION=2.6.12-1
RUN apt-get update -qq \
	&& apt-get install -qy haproxy=${HAPROXY_VERSION} iptables --no-install-recommends \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/*.list /etc/haproxy/* /etc/rsyslog.d/49-haproxy.conf /etc/openvpn/* /etc/defaults/openvpn \
	&& ln -sf /usr/src/app/openvpn/scripts /etc/openvpn/scripts \
	&& systemctl mask openvpn@.service openvpn.service

ENV LIBNSS_OPENVPN_VERSION 22feb11322182f6fd79f85cd014b65b6c40b7b47
RUN tmp="$(mktemp -d)" ; set -x \
	&& git clone -q https://github.com/balena-io-modules/libnss-openvpn.git "${tmp}" \
	&& cd "${tmp}" \
	&& git -C "${tmp}" checkout -q ${LIBNSS_OPENVPN_VERSION} \
	&& make -C "${tmp}" -j "$(nproc)" \
	&& make -C "${tmp}" install \
	&& sed --in-place --regexp-extended 's|(hosts:\W+)(.*)|\1openvpn \2|' /etc/nsswitch.conf \
	&& rm -rf "${tmp}"

COPY package.json package-lock.json /usr/src/app/
RUN npm ci --production && npm cache clean --force

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
