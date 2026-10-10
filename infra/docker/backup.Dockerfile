# syntax=docker/dockerfile:1.7
# Nightly encrypted database backups to Cloudflare R2, and the matching restore tool.
# Build from the repository root:  docker build -f infra/docker/backup.Dockerfile .
#
# Why a separate image and not a worker job: pg_dump has to match the server's major version
# (18), the worker image is deliberately tiny and has no route to the internet, and a backup
# must still run (and still alert) when the worker or the API is broken.
ARG ALPINE_IMAGE=alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6

# The Alpine `rclone` package lags upstream and carries ~20 HIGH advisories in its Go dependencies
# (ssh, grpc, x/net), so the official release binary is used instead, verified by SHA-256.
# To update: pick a release, copy both hashes from
# https://github.com/rclone/rclone/releases/download/<version>/SHA256SUMS
FROM ${ALPINE_IMAGE} AS rclone
ARG RCLONE_VERSION=v1.75.2
ARG RCLONE_SHA256_AMD64=349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702
ARG RCLONE_SHA256_ARM64=7e1e8d69654941b7b7df84ee74c5f7fb09cce7d5496947fb7bf16b55ff427d10
RUN apk add --no-cache curl unzip \
 && case "$(uname -m)" in \
      x86_64)  arch=amd64; sha="$RCLONE_SHA256_AMD64" ;; \
      aarch64) arch=arm64; sha="$RCLONE_SHA256_ARM64" ;; \
      *) echo "unsupported architecture" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/rclone.zip "https://github.com/rclone/rclone/releases/download/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-${arch}.zip" \
 && echo "${sha}  /tmp/rclone.zip" | sha256sum -c - \
 && unzip -j /tmp/rclone.zip '*/rclone' -d /out \
 && chmod 755 /out/rclone

FROM ${ALPINE_IMAGE}
# postgresql18-client: pg_dump / pg_restore / psql 18   age: encryption   jq: parses rclone listings
RUN apk add --no-cache bash curl jq postgresql18-client age \
 && addgroup -g 1000 backup && adduser -u 1000 -G backup -s /sbin/nologin -D backup \
 && rm -rf /sbin/apk /etc/apk /lib/apk /usr/share/apk /var/cache/apk
COPY --from=rclone /out/rclone /usr/local/bin/rclone
COPY --chmod=755 infra/scripts/backup.sh infra/scripts/restore.sh /usr/local/bin/
USER backup
WORKDIR /tmp
# No long-running process: the container is started by a systemd timer, runs once and exits.
CMD ["backup.sh"]
