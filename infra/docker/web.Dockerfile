# syntax=docker/dockerfile:1.7
# Build from the repository root:  docker build -f infra/docker/web.Dockerfile .
ARG NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ARG ALPINE_IMAGE=alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6

FROM ${NODE_IMAGE} AS tooling
RUN npm install --global --no-audit --no-fund pnpm@10.34.6 turbo@2.11.7
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /repo

FROM tooling AS prune
COPY . .
RUN turbo prune @wasfa/web --docker

FROM tooling AS build
COPY --from=prune /repo/out/json/ .
COPY --from=prune /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
# The lockfile records this file's checksum; without it `--frozen-lockfile` refuses to install.
COPY .pnpmfile.cjs ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
# NEXT_PUBLIC_* are inlined into the bundle, so they are build arguments, not runtime settings.
# Defaults describe production; override for a staging image (anything but `production` is noindex).
ARG NEXT_PUBLIC_ENV=production
ARG NEXT_PUBLIC_SITE_URL=https://wasfa.online
ARG NEXT_PUBLIC_API_URL=https://api.wasfa.online
# Public Turnstile site key (not a secret). Empty = no widget, which only works with an API that has no secret.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ENV NEXT_PUBLIC_ENV=$NEXT_PUBLIC_ENV \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
# Fonts are fetched from Google here, at build time, and bundled; the running site never contacts Google.
RUN pnpm --filter "@wasfa/web..." run build \
 && find apps/web/.next/standalone apps/web/.next/static -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' \) -delete

# A Node binary without debug symbols; see api.Dockerfile.
FROM ${NODE_IMAGE} AS node-slim
RUN apk add --no-cache binutils \
 && strip --strip-unneeded -o /node /usr/local/bin/node

FROM ${ALPINE_IMAGE} AS runtime
RUN apk add --no-cache libstdc++ \
 && addgroup -g 1000 node && adduser -u 1000 -G node -s /sbin/nologin -D node \
 && rm -rf /sbin/apk /etc/apk /lib/apk /usr/share/apk /var/cache/apk
COPY --from=node-slim /node /usr/local/bin/node
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# `output: "standalone"` traces only the files the server needs (outputFileTracingRoot = repo root).
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
