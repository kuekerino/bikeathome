# syntax=docker/dockerfile:1

# Two stages so the server never needs Node: the build happens here, and what
# ships is a web server plus 140 KB of static files.

FROM node:22-alpine AS build
WORKDIR /app

# Copied first so a dependency install is only redone when the lockfile moves.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8443

# Checks the listener rather than fetching a page: the site is matched by
# hostname, so an HTTP probe to 127.0.0.1 would not match it and would fail
# a perfectly healthy container.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD nc -z 127.0.0.1 8443 || exit 1
