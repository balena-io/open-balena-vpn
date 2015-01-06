FROM dockerfile/nodejs

RUN echo 'deb http://rep.logentries.com/ trusty main' > /etc/apt/sources.list.d/logentries.list \
	&& gpg --keyserver pgp.mit.edu --recv-keys C43C79AD && gpg -a --export C43C79AD | apt-key add - \
	&& apt-get -q update \
	&& apt-get install -qy supervisor openvpn wget logentries logentries-daemon curl \
	&& apt-get clean && rm -rf /var/lib/apt/lists/*

RUN wget -O /usr/local/bin/confd https://github.com/kelseyhightower/confd/releases/download/v0.6.0-alpha3/confd-0.6.0-alpha3-linux-amd64 && chmod a+x /usr/local/bin/confd && mkdir -p /etc/confd/conf.d && mkdir /etc/confd/templates

RUN useradd openvpn
RUN mkdir -p /var/run/

ADD ./config/env.toml /etc/confd/conf.d/env.toml
ADD ./config/env.tmpl /etc/confd/templates/env.tmpl

RUN mkdir /resin-log

ADD resin-vpn.conf /etc/supervisor/conf.d/resin-vpn.conf
ADD resin-vpn-api.conf /etc/supervisor/conf.d/resin-vpn-api.conf
ADD ./config /etc/openvpn
ADD . /app

WORKDIR /app
RUN npm install --production && npm cache clean

RUN chown openvpn:openvpn /app/scripts/client-connect.sh
RUN chmod u+x /app/scripts/client-connect.sh
RUN chown openvpn:openvpn /app/scripts/client-disconnect.sh
RUN chmod u+x /app/scripts/client-disconnect.sh

EXPOSE 1194
EXPOSE 11194
EXPOSE 80

WORKDIR /etc/openvpn
ENTRYPOINT ["/app/entry.sh"]

CMD ["tail", "-f", "/var/log/supervisor/supervisord.log"]
