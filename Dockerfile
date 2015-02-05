FROM dockerfile/nodejs

# Logentries/supervisor
RUN echo 'deb http://rep.logentries.com/ trusty main' > /etc/apt/sources.list.d/logentries.list \
	&& gpg --keyserver pgp.mit.edu --recv-keys C43C79AD && gpg -a --export C43C79AD | apt-key add - \
	&& apt-get -q update \
	&& apt-get install -qy supervisor wget logentries logentries-daemon \
	&& apt-get clean && rm -rf /var/lib/apt/lists/*

# Confd
ENV CONFD_VERSION 0.7.1
RUN wget -O /usr/local/bin/confd https://github.com/kelseyhightower/confd/releases/download/v${CONFD_VERSION}/confd-${CONFD_VERSION}-linux-amd64 \
	&& chmod a+x /usr/local/bin/confd \
	&& mkdir -p /etc/confd/conf.d \
	&& mkdir /etc/confd/templates

# Openvpn
RUN apt-get -q update \
	&& apt-get install -qy openvpn \
	&& apt-get clean && rm -rf /var/lib/apt/lists/*

# Additional apt packages
RUN apt-get -q update \
	&& apt-get install -qy curl \
	&& apt-get clean && rm -rf /var/lib/apt/lists/*

# Confd config
COPY config/env.toml /etc/confd/conf.d/env.toml
COPY config/env.tmpl /etc/confd/templates/env.tmpl

# Supervisor configs
RUN mkdir /resin-log
COPY resin-vpn.conf resin-vpn-legacy.conf /etc/supervisor/conf.d/

RUN useradd openvpn
RUN mkdir -p /var/run/

COPY resin-vpn-api.conf /etc/supervisor/conf.d/
COPY config /etc/openvpn

COPY package.json /app/
RUN cd /app && npm install --production && npm cache clean
COPY . /app

WORKDIR /app/scripts
RUN chown openvpn *.sh && chmod u+x *.sh

EXPOSE 80 443 1194

WORKDIR /etc/openvpn
ENTRYPOINT ["/app/entry.sh"]

CMD ["tail", "-f", "/var/log/supervisor/supervisord.log"]
