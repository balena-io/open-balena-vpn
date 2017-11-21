.PHONY: all renew clean purge

all: server.crt clean

renew: purge server.crt clean

ca.key.asc:
	echo "Missing ca.key.asc!" 2>&1
	exit 1

ca.crt:
	echo "Missing ca.crt!" 2>&1
	exit 1

server.csr:
	openssl req -new -sha256 -nodes \
		-newkey rsa:2048 \
		-keyout server.key \
		-out server.csr \
		-subj "/C=US/ST=WA/L=Seattle/O=Resin.io/OU=VPN/CN=ResinVPN"

server.crt: server.csr ca.crt ca.key.asc
	gpg --decrypt ca.key.asc > ca.key
	openssl x509 -req -sha256 \
		-days 720 \
		-CAkey ca.key \
		-CA ca.crt \
		-in server.csr \
		-CAcreateserial \
		-extfile extensions.cnf \
		-out server.crt
	openssl x509 -in server.crt -text -noout > tmp.crt
	cat server.crt >> tmp.crt
	mv tmp.crt server.crt

clean:
	@rm -f *.srl ca.key

purge:
	@rm -f server.crt server.csr server.key

