FROM resin/resin-base:bf7392a

EXPOSE 80 443 1194

COPY package.json /usr/src/app/
RUN npm install --unsafe-perm --production && npm cache clean

COPY . /usr/src/app

COPY config/services/ /etc/systemd/system/

RUN echo AUTOSTART=none > /etc/default/openvpn \
	&& rm -rf /etc/openvpn \
	&& ln -s /usr/src/app/openvpn /etc/openvpn

RUN systemctl enable resin-vpn.service
