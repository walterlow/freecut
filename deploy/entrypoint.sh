#!/bin/sh
# Resolve TELEGRAM_DOWNLOADER_URL for the nginx proxy.
#
# The .env file sets a browser-facing URL (e.g. http://localhost:8300).
# Inside Docker "localhost" means the container — map it to the host.
# The result (host:port) is substituted into nginx.conf.template.
set -e

TARGET="${TELEGRAM_DOWNLOADER_URL:-http://localhost:8300}"

# Replace Docker-localhost with the host gateway so the proxy can reach
# the downloader on the host machine.
TARGET=$(echo "$TARGET" | \
  sed -E 's#://(localhost|127\.0\.0\.1):#://host.docker.internal:#')

# Strip protocol — nginx proxy_pass adds http://.
export TARGET="${TARGET#http://}"
export TARGET="${TARGET#https://}"

envsubst '$TARGET' \
  < /etc/nginx/conf.d/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec "$@"
