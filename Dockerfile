FROM balena/open-balena-base:20.2.8-s6-overlay AS base

FROM base AS builder
COPY package.json package-lock.json /usr/src/app/
RUN npm ci && npm cache clean --force 2>/dev/null
COPY tsconfig.json tsconfig.dev.json /usr/src/app/
COPY typings /usr/src/app/typings
COPY test /usr/src/app/test
COPY src /usr/src/app/src
RUN npm run build

########################################################
# Plugins
########################################################

FROM base AS plugin-builder

# https://docs.renovatebot.com/modules/datasource/repology/
# renovate: datasource=repology depName=debian_13/openvpn versioning=loose
ARG OPENVPN_VERSION=2.6.14-1+deb13u1

# hadolint ignore=DL3008
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
	git \
	libssl-dev \
	openvpn=${OPENVPN_VERSION} \
	&& rm -rf /var/lib/apt/lists/*

########################################################
# Connect-Disconnect Plugin
########################################################

FROM plugin-builder AS connect-disconnect-plugin

ARG CONNECT_DISCONNECT_PLUGIN_COMMIT=7c958d8b33a87a06b5a8fa096397fc623494013a

WORKDIR /usr/src/app/connect-disconnect-script-openvpn
RUN git clone https://github.com/balena-io-modules/connect-disconnect-script-openvpn.git . \
	&& git checkout ${CONNECT_DISCONNECT_PLUGIN_COMMIT} \
	&& C_INCLUDE_PATH=/usr/include/openvpn/ make plugin

########################################################
# Learn-Address Plugin
########################################################

FROM plugin-builder AS learn-address-plugin

ARG LEARN_ADDRESS_PLUGIN_COMMIT=8181b15c11dcbf437d1ea53eebf1dec75082f495

WORKDIR /usr/src/app/learn-address-script-openvpn
RUN git clone https://github.com/balena-io-modules/learn-address-script-openvpn.git . \
	&& git checkout ${LEARN_ADDRESS_PLUGIN_COMMIT} \
	&& C_INCLUDE_PATH=/usr/include/openvpn/ make plugin

########################################################
# Auth Plugin
########################################################

FROM plugin-builder AS auth-plugin

ARG OAS_PLUGIN_COMMIT=623982a5d63dd2b7b2b9f9295d10d96a56d58894

WORKDIR /usr/src/app/auth-script-openvpn
RUN git clone https://github.com/fac/auth-script-openvpn.git . \
	&& git checkout ${OAS_PLUGIN_COMMIT} \
	&& C_INCLUDE_PATH=/usr/include/openvpn/ make plugin

########################################################
# Rust Builder
########################################################

FROM rust:1-trixie AS rust-builder

WORKDIR /usr/src/app
COPY auth .
RUN cargo build --release

########################################################
# Eget Builder
########################################################

FROM golang:1.25.7 AS eget-builder

WORKDIR /src

ARG EGET_VERSION=v1.3.3
ARG CGO_ENABLED=0

RUN git clone https://github.com/zyedidia/eget . \
    && git checkout -q ${EGET_VERSION} \
    && make build \
    && make install

WORKDIR /opt

########################################################
# Node Exporter
########################################################

FROM eget-builder AS node-exporter

# renovate: datasource=github-releases depName=prometheus/node_exporter
ARG NODE_EXPORTER_TAG=1.3.1

RUN eget prometheus/node_exporter \
	--tag v${NODE_EXPORTER_TAG} --asset ".tar.gz" \
    --file "node_exporter" --to "/usr/local/bin/"

########################################################
# Process Exporter
########################################################

FROM eget-builder AS process-exporter

# renovate: datasource=github-releases depName=ncabatoff/process-exporter
ARG PROCESS_EXPORTER_TAG=0.7.10

RUN eget ncabatoff/process-exporter \
	--tag v${PROCESS_EXPORTER_TAG} --asset ".tar.gz" \
    --file "process-exporter" --to "/usr/local/bin/"

########################################################
# Openvpn Exporter
########################################################

FROM eget-builder AS openvpn-exporter

# renovate: datasource=github-releases depName=natrontech/openvpn-exporter
ARG OPENVPN_EXPORTER_TAG=1.0.2

RUN eget natrontech/openvpn-exporter \
	--tag v${OPENVPN_EXPORTER_TAG} --asset ".tar.gz" --asset "^sbom" \
    --file "openvpn-exporter-linux-*" --to "/usr/local/bin/openvpn-exporter"

########################################################
# Sshproxy
########################################################

FROM eget-builder AS sshproxy

# renovate: datasource=github-releases depName=balena-io/sshproxy
ARG SSHPROXY_TAG=1.4.1

RUN eget balena-io/sshproxy --tag v${SSHPROXY_TAG} \
	--asset ".tar.gz" --file "*" --to "/usr/local/bin/"

########################################################
# Libnss-openvpn
########################################################

FROM plugin-builder AS libnss-openvpn

ENV LIBNSS_OPENVPN_VERSION=ea16a3f1565353b1ff9a41e9b0f8ffeee97ce7d5

WORKDIR /usr/src/app/libnss-openvpn
RUN git clone https://github.com/balena-io-modules/libnss-openvpn.git . \
	&& git checkout ${LIBNSS_OPENVPN_VERSION} \
	&& make -j "$(nproc)" \
	&& make install DESTDIR=/opt

########################################################
# Main
########################################################

FROM base AS main

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

COPY --from=node-exporter /usr/local/bin/node_exporter /usr/local/bin/
COPY --from=process-exporter /usr/local/bin/process-exporter /usr/local/bin/
COPY --from=openvpn-exporter /usr/local/bin/openvpn-exporter /usr/local/bin/
COPY --from=sshproxy /usr/local/bin/* /usr/local/bin/
COPY --from=libnss-openvpn /opt/ /

# https://docs.renovatebot.com/modules/datasource/repology/
# renovate: datasource=repology depName=debian_13/haproxy versioning=loose
ARG HAPROXY_VERSION=3.0.11-1+deb13u2

# https://docs.renovatebot.com/modules/datasource/repology/
# renovate: datasource=repology depName=debian_13/openvpn versioning=loose
ARG OPENVPN_VERSION=2.6.14-1+deb13u1

# hadolint ignore=DL3008
RUN apt-get update -qq \
	&& apt-get install -qy --no-install-recommends \
		haproxy=${HAPROXY_VERSION} iptables socat openvpn=${OPENVPN_VERSION} \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/*.list /etc/haproxy/* /etc/rsyslog.d/49-haproxy.conf /etc/openvpn/* /etc/defaults/openvpn \
	&& ln -sf /usr/src/app/openvpn/scripts /etc/openvpn/scripts \
	&& setcap 'cap_net_admin=ep' /usr/sbin/tc

RUN sed --in-place --regexp-extended 's|(hosts:\W+)(.*)|\1openvpn \2|' /etc/nsswitch.conf

COPY package.json package-lock.json /usr/src/app/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=auth-plugin /usr/src/app/auth-script-openvpn/openvpn-plugin-auth-script.so /etc/openvpn/plugins/
COPY --from=builder /usr/src/app/build /usr/src/app/build
COPY --from=connect-disconnect-plugin /usr/src/app/connect-disconnect-script-openvpn/openvpn-plugin-connect-disconnect-script.so /etc/openvpn/plugins/
COPY --from=learn-address-plugin /usr/src/app/learn-address-script-openvpn/openvpn-plugin-learn-address-script.so /etc/openvpn/plugins/
COPY --from=rust-builder /usr/src/app/target/release/auth /usr/src/app/openvpn/scripts/auth
COPY config /usr/src/app/config
COPY openvpn /usr/src/app/openvpn
COPY openvpn-exporter /usr/src/app/openvpn-exporter
COPY docker-hc /usr/src/app/
COPY config/s6-overlay /etc/s6-overlay
COPY bin/*.sh /etc/s6-overlay/scripts/
RUN chmod +x /etc/s6-overlay/scripts/* /usr/src/app/openvpn-exporter/bin/start.sh

# Setup learn-address script with proper permissions and directories
RUN chmod +x /usr/src/app/openvpn/scripts/learn-address.sh \
	&& mkdir -p /var/lib/openvpn/tc-state /var/log/openvpn \
	&& chmod 700 /var/lib/openvpn/tc-state \
	&& chown nobody:nogroup /var/lib/openvpn/tc-state /var/log/openvpn

ENTRYPOINT [ "/etc/s6-overlay/scripts/entry.sh" ]
