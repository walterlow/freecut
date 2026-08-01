# FreeCut web app.
#
# Multi-stage build: Vite static bundle (dist/) served by nginx.
#
# Local dev:     npm run dev     → Vite reads .env, calls downloader directly
# Docker:        docker compose up --build  → nginx proxies /api to downloader
#
# For Docker the downloader URL goes through the proxy (same-origin, no CORS/
# COEP). Local dev calls the downloader directly (no proxy headers needed).

FROM node:24-bookworm AS build

WORKDIR /app

ARG VITE_TELEGRAM_DOWNLOADER_URL
# If empty the app uses relative /api/… paths (go through the nginx proxy).

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ── runtime ──
FROM nginx:1.27-alpine

# envsubst needs gettext
RUN apk add --no-cache gettext

COPY deploy/nginx.conf.template /etc/nginx/conf.d/default.conf.template
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
