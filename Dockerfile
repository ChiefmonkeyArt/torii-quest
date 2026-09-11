# syntax=docker/dockerfile:1
#
# Torii Quest — self-hosting image.
# Two runtime targets built from one multi-stage file:
#   web       (default) Caddy serving the static game; see docker-compose.yml.
#   arena-ws  slim Node runtime for the multiplayer server, selected in
#             docker-compose.yml via `target: arena-ws`.
# Caddy also reverse-proxies /relay -> strfry and /mp -> arena-ws (see
# docker-compose.yml + Caddyfile).
#
# Build:   docker compose build
# Run:     docker compose up -d

## ---- Stage 1: build the static game (dist/) + bundled server (dist/server/) ----
FROM node:20-alpine AS build
WORKDIR /app

# Install deps first for layer caching
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build (dashboard + vite build -> dist/, esbuild -> dist/server/arena-ws.cjs)
COPY . .
RUN npm run build

## ---- Stage 2a: serve the static game with Caddy (default target) ----
FROM caddy:2-alpine AS web

# Substitute the real per-build CSP header (from dist/_headers, written by
# the Vite plugin in tools/csp.mjs) into the Caddyfile's __CSP_HEADER__
# placeholder. This is the single source of truth for the policy — copying
# a second hand-written copy here would drift the first time the inline
# bootstrap sha changes. connect-src only APPENDS wss://$DOMAIN to the
# existing canonical relay list (so the browser may open the multiplayer
# socket back to this origin, VPS_INSTALL.md §16), never replaces it — a
# replacement drops the configured Gamestr/Routstr/Vertex/Plebeian relays (F04).
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/_headers /tmp/_headers
RUN CSP="$(grep 'Content-Security-Policy' /tmp/_headers | sed -E 's/^[[:space:]]*Content-Security-Policy:[[:space:]]*//')" && \
    CSP="$(printf '%s' "$CSP" | sed -E 's#(connect-src[^;]*)#\1 wss://{$DOMAIN}#')" && \
    sed -i "s#__CSP_HEADER__#${CSP}#" /etc/caddy/Caddyfile && \
    rm /tmp/_headers

# Baked static build (immutable, served from S3-less local file_server)
COPY --from=build /app/dist /srv

EXPOSE 80 443

## ---- Stage 2b: run the multiplayer server (slim Node, no source tree) ----
# The esbuild bundle in dist/server/arena-ws.cjs inlines everything except the
# `ws` AND `draco3d` packages (both marked --external: see tools/write-server-
# runtime-manifest.mjs). draco3d is imported at module load by the headless-GLB
# authoring path, so a ws-only install crashes the server at startup. Consume
# the SAME generated manifest the VPS installer uses instead of re-listing deps.
FROM node:20-alpine AS arena-ws
WORKDIR /app
COPY --from=build /app/dist/package.json ./package.json
COPY --from=build /app/dist/server/arena-ws.cjs ./server/arena-ws.cjs
RUN npm install --omit=dev --no-audit --no-fund
# Loopback is the source default (audit F07). A container must listen on
# container-internal 0.0.0.0 so the Caddy reverse proxy (a sibling container on
# the compose network) can reach it — but the port is NEVER published to the
# host (docker-compose.yml sets no `ports:` on arena-ws).
ENV HOST=0.0.0.0
USER node
EXPOSE 8787
CMD ["node", "server/arena-ws.cjs"]
