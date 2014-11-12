FROM ubuntu:14.04

RUN echo 'deb http://rep.logentries.com/ trusty main' > /etc/apt/sources.list.d/logentries.list \
	&& gpg --keyserver pgp.mit.edu --recv-keys C43C79AD && gpg -a --export C43C79AD | apt-key add - \
	&& apt-get -q update \
	&& apt-get install -qy supervisor openvpn wget logentries logentries-daemon \
	&& apt-get clean && rm -rf /var/lib/apt/lists/*

RUN wget -O /usr/local/bin/confd https://github.com/kelseyhightower/confd/releases/download/v0.6.0-alpha3/confd-0.6.0-alpha3-linux-amd64 && chmod a+x /usr/local/bin/confd && mkdir -p /etc/confd/conf.d && mkdir /etc/confd/templates

ADD ./config/env.toml /etc/confd/conf.d/env.toml
ADD ./config/env.tmpl /etc/confd/templates/env.tmpl

RUN mkdir /resin-log
ADD resin-vpn.conf /etc/supervisor/conf.d/resin-vpn.conf
ADD ./config /etc/openvpn
ADD ./entry.sh /entry.sh

EXPOSE 1194
EXPOSE 11194

WORKDIR /etc/openvpn
ENTRYPOINT ["/entry.sh"]
CMD ["tail", "-f", "/var/log/supervisor/supervisord.log"]
