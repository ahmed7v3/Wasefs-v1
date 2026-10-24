# syntax=docker/dockerfile:1.7
# Nightly encrypted database backups to Cloudflare R2, and the matching restore tool.
# Build from the repository root:  docker build -f infra/docker/backup.Dockerfile .
#
# Why a separate image and not a worker job: pg_dump has to match the server's major version
# (18), the worker image is deliberately tiny and has no route to the internet, and a backup
# must still run (and still alert) when the worker or the API is broken.
ARG ALPINE_IMAGE=alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6

# rclone is built from source with a patched Go toolchain: the Alpine package lags upstream (~20 HIGH
# advisories in its Go dependencies), and the v1.75.2 release binary is built with Go 1.26.8, which
# has the crypto/x509 man-in-the-middle flaw CVE-2026-111943, and rclone talks TLS to R2. The module
# download is verified against go.sum and the Go checksum database. To update: bump RCLONE_VERSION;
# go back to the release binary once one is built with Go >= 1.26.10.
FROM golang:1.26.10-alpine3.24@sha256:27f2d3b83cfc5803c8078f8e730af0f7c431bf067afaec8f60a36fb763187cba AS rclone
ARG RCLONE_VERSION=v1.75.2
RUN CGO_ENABLED=0 GOBIN=/out go install -trimpath \
      -ldflags "-s -w -X github.com/rclone/rclone/fs.Version=${RCLONE_VERSION}" \
      "github.com/rclone/rclone@${RCLONE_VERSION}" \
 && /out/rclone version | head -2

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
