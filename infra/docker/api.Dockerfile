# syntax=docker/dockerfile:1.7
# Build from the repository root:  docker build -f infra/docker/api.Dockerfile .
# Also used for the one-off `migrate` container (it contains @wasfa/db and its SQL migrations).

# Pinned by digest so a moved tag cannot change what we ship. Bump deliberately (Dependabot opens the PR).
ARG NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
# Must be the same Alpine release the Node image is built on (musl ABI): see `cat /etc/alpine-release`.
ARG ALPINE_IMAGE=alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6

FROM ${NODE_IMAGE} AS tooling
# Versions must match package.json `packageManager` and the turbo devDependency.
RUN npm install --global --no-audit --no-fund pnpm@10.34.6 turbo@2.11.7
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /repo

# 1) Keep only this app's workspace packages and the matching slice of the lockfile.
FROM tooling AS prune
COPY . .
RUN turbo prune @wasfa/api --docker

# 2) Install dependencies (cached until a package.json or the lockfile changes), then build.
FROM tooling AS build
COPY --from=prune /repo/out/json/ .
COPY --from=prune /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
# The lockfile records this file's checksum; without it `--frozen-lockfile` refuses to install.
COPY .pnpmfile.cjs ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
# `...` builds @wasfa/shared and @wasfa/db first, then the API.
RUN pnpm --filter "@wasfa/api..." run build
# Production dependencies only, with the built workspace packages copied in.
RUN pnpm --filter @wasfa/api deploy --legacy --prod /out \
 && find /out -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -iname '*.md' \) -delete

# 3) A Node binary without debug symbols (-17 MB). Deleting files in a later layer would not
#    shrink an image, so the runtime is assembled from a bare Alpine plus this one binary.
FROM ${NODE_IMAGE} AS node-slim
RUN apk add --no-cache binutils \
 && strip --strip-unneeded -o /node /usr/local/bin/node

# 4) Runtime image: Node and its two shared libraries. No npm, yarn, corepack or package manager.
FROM ${ALPINE_IMAGE} AS runtime
RUN apk add --no-cache libstdc++ \
 && addgroup -g 1000 node && adduser -u 1000 -G node -s /sbin/nologin -D node \
 && rm -rf /sbin/apk /etc/apk /lib/apk /usr/share/apk /var/cache/apk
COPY --from=node-slim /node /usr/local/bin/node
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Unprivileged user `node` (uid 1000).
USER node
EXPOSE 4000
# Liveness only: readiness (DB + Redis) is what compose and the deploy script poll.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health/live').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
