# syntax=docker/dockerfile:1.7
# Build from the repository root:  docker build -f infra/docker/worker.Dockerfile .
ARG NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ARG ALPINE_IMAGE=alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6

FROM ${NODE_IMAGE} AS tooling
RUN npm install --global --no-audit --no-fund pnpm@10.34.6 turbo@2.11.7
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /repo

FROM tooling AS prune
COPY . .
RUN turbo prune @wasfa/worker --docker

FROM tooling AS build
COPY --from=prune /repo/out/json/ .
COPY --from=prune /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
# The lockfile records this file's checksum; without it `--frozen-lockfile` refuses to install.
COPY .pnpmfile.cjs ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm --filter "@wasfa/worker..." run build
RUN pnpm --filter @wasfa/worker deploy --legacy --prod /out \
 && cp -r apps/worker/assets /out/assets \
 && mkdir -p /out/src/og \
 && cp -r apps/worker/src/og/assets /out/src/og/assets \
 && mkdir -p /out/src/documents \
 && cp -r apps/worker/src/documents/templates /out/src/documents/templates \
 && find /out -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -iname '*.md' \) -delete

FROM ${NODE_IMAGE} AS node-slim
RUN apk add --no-cache binutils \
 && strip --strip-unneeded -o /node /usr/local/bin/node

FROM ${ALPINE_IMAGE} AS runtime
# typst renders the PDFs and cards the WhatsApp agent sends (apps/worker/src/documents); the worker
# points it at the bundled fonts only. From the Alpine community repository (0.14.2 on 3.24).
RUN apk add --no-cache libstdc++ typst \
 && addgroup -g 1000 node && adduser -u 1000 -G node -s /sbin/nologin -D node \
 && rm -rf /sbin/apk /etc/apk /lib/apk /usr/share/apk /var/cache/apk
COPY --from=node-slim /node /usr/local/bin/node
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
# No HTTP port: healthy = the heartbeat the worker writes every 5 minutes is fresh.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/main.js"]
