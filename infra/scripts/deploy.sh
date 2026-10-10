#!/usr/bin/env bash
# Deploys one git SHA of the production stack on the server and rolls back if it does not become
# healthy. Run by .github/workflows/deploy.yml over SSH; can also be run by hand:
#
#   printf '%s' "$GHCR_TOKEN" | /opt/wasfa/deploy.sh <40-char-git-sha> <ghcr-username>
#
# The GHCR token (read:packages) arrives on stdin so it never shows up in a process list, and is
# stored in a temporary Docker config that is deleted on exit: no long-lived registry credential
# lives on the server.
#
# Order matters:  pull -> migrate -> up -> wait for /health/ready -> (rollback on failure).
# Migrations run BEFORE the new containers start and are NOT rolled back. Write every migration
# so the previous release still works with the new schema (add columns/tables first, remove them
# in a later release), otherwise a rollback leaves old code running against a new schema.
#
# Environment (all optional, mainly for tests):
#   WASFA_DIR          directory holding compose.prod.yml and .env.prod   (default /opt/wasfa)
#   READY_TIMEOUT      seconds to wait for the new release to be ready   (default 60)
#   DEPLOY_SKIP_LOGIN  1 = do not log in to GHCR (reads no token)
#   DEPLOY_SKIP_PULL   1 = do not pull (images already present, e.g. local testing)
set -euo pipefail

WASFA_DIR="${WASFA_DIR:-/opt/wasfa}"
READY_TIMEOUT="${READY_TIMEOUT:-60}"
SHA="${1:-}"
GHCR_USER="${2:-}"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "usage: deploy.sh <40-char-git-sha> <ghcr-username> (token on stdin)"
cd "$WASFA_DIR"
[[ -f .env.prod ]] || die "$WASFA_DIR/.env.prod is missing"

if [[ "${DEPLOY_SKIP_LOGIN:-0}" != "1" ]]; then
  [[ -n "$GHCR_USER" ]] || die "ghcr username is required"
  # `read` fails on a last line without a trailing newline but still fills the variable.
  IFS= read -r GHCR_TOKEN || [[ -n "${GHCR_TOKEN:-}" ]] || die "no GHCR token on stdin"
  umask 077
  DOCKER_CONFIG="$(mktemp -d)"
  export DOCKER_CONFIG
  trap 'rm -rf "$DOCKER_CONFIG"' EXIT
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
  unset GHCR_TOKEN
fi

# IMAGE_TAG in the shell wins over the one in .env.prod.
dc() { docker compose --env-file .env.prod -f compose.prod.yml "$@"; }

# Succeeds when the API container answers /health/ready with 200 (database and Redis reachable).
# Goes through the container, not Caddy: Caddy requires Cloudflare's client certificate.
api_ready() {
  dc exec -T api node -e \
    "fetch('http://127.0.0.1:4000/health/ready').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))" \
    >/dev/null 2>&1
}

wait_ready() {
  local waited=0
  while (( waited < READY_TIMEOUT )); do
    if api_ready; then return 0; fi
    sleep 2
    waited=$(( waited + 2 ))
  done
  return 1
}

PREVIOUS=""
[[ -f .deployed-sha ]] && PREVIOUS="$(tr -d '[:space:]' < .deployed-sha)"
log "deploying $SHA (currently: ${PREVIOUS:-nothing})"

export IMAGE_TAG="$SHA"

if [[ "${DEPLOY_SKIP_PULL:-0}" != "1" ]]; then
  log "pulling images"
  # `--profile tools` includes the backup image (the migrate service reuses the API image).
  dc --profile tools pull
fi

log "running migrations"
dc run --rm migrate || die "migration failed; the running release was not touched"

log "starting containers"
# `up -d` itself fails when a dependency (e.g. the API) never becomes healthy, so a failure here is
# a failed release to roll back, not a reason to abort the script (set -e would skip the rollback).
started=0
dc up -d --remove-orphans || started=1

if (( started == 0 )); then
  log "waiting up to ${READY_TIMEOUT}s for /health/ready"
  if wait_ready; then
    printf '%s\n' "$SHA" > .deployed-sha
    # Keep images used in the last week so a manual rollback does not need a pull.
    docker image prune -af --filter "until=168h" >/dev/null 2>&1 || true
    log "release $SHA is healthy"
    exit 0
  fi
fi

log "release $SHA did not become ready"
dc logs --tail 40 api worker web 2>&1 | sed 's/^/    /' || true

if [[ -z "$PREVIOUS" ]]; then
  die "no previous release to roll back to; leaving the stack as it is"
fi

log "rolling back to $PREVIOUS"
export IMAGE_TAG="$PREVIOUS"
dc up -d --remove-orphans
if wait_ready; then
  log "rolled back to $PREVIOUS and it is healthy"
else
  log "ROLLBACK ALSO FAILED: $PREVIOUS is not healthy either, manual intervention needed"
fi
exit 1
