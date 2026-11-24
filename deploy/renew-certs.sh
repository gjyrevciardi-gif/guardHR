#!/bin/sh
# Issue or renew the Let's Encrypt certificate and install it for the proxy and the TURN relay (docs/staging.md).
# Run from the repository root by a user who can run docker, for example daily from cron:
#   17 3 * * * cd /srv/nemoguard && ./deploy/renew-certs.sh hr.example.com you@example.com >> deploy/renew.log 2>&1
# It does nothing while the installed certificate is valid for more than 30 days. Otherwise it stops the proxy for a few
# seconds (the HTTP challenge needs port 80), gets the certificate, copies it to deploy/certs and starts the proxy again.
set -eu
DOMAIN=${1:?usage: renew-certs.sh DOMAIN EMAIL}
EMAIL=${2:?usage: renew-certs.sh DOMAIN EMAIL}
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
CERTBOT=certbot/certbot:v5.10.0
CERTS=deploy/certs

if [ -f "$CERTS/fullchain.pem" ] && openssl x509 -checkend 2592000 -noout -in "$CERTS/fullchain.pem" >/dev/null; then
  echo "$(date -u +%FT%TZ) certificate for $DOMAIN is valid for more than 30 days, nothing to do"
  exit 0
fi

mkdir -p "$CERTS" deploy/letsencrypt
# Whatever happens below, bring the proxy back if there is a certificate for it to serve.
restore() { if [ -f "$CERTS/fullchain.pem" ]; then $COMPOSE up -d proxy; fi; }
trap restore EXIT

$COMPOSE stop proxy || true
docker run --rm -p 80:80 -v "$PWD/deploy/letsencrypt:/etc/letsencrypt" "$CERTBOT" \
  certonly --standalone -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --keep-until-expiring
# certbot's files are root-only symlinks, so copy them from inside a container. The relay runs as an unprivileged user
# and must be able to read the key: keep the server dedicated to this app, or give the relay its own certificate.
docker run --rm --entrypoint sh -v "$PWD/deploy/letsencrypt:/le:ro" -v "$PWD/$CERTS:/out" "$CERTBOT" \
  -c "cp -L /le/live/$DOMAIN/fullchain.pem /le/live/$DOMAIN/privkey.pem /out/ && chmod 644 /out/fullchain.pem /out/privkey.pem"

restore
if [ -n "$($COMPOSE --profile turn ps -q turn)" ]; then $COMPOSE --profile turn restart turn; fi # it reads the certificate at start
echo "$(date -u +%FT%TZ) certificate for $DOMAIN installed"
