#!/usr/bin/env bash
# Restores (or test-restores) an encrypted backup made by backup.sh. Runs in the `backup` image.
#
#   restore.sh --verify  [latest|<key>]            restore into a scratch database, compare every
#                                                  table's row count with the backup's manifest,
#                                                  drop the scratch database. Changes nothing else.
#   restore.sh --into <database> [latest|<key>]    restore into <database> (created if missing).
#                                                  Refuses the live database unless --overwrite-live.
#
# <key> is an object under the bucket, e.g. daily/wasfa-2026-10-10T023000Z.dump.age or
# weekly/...; `latest` (default) is the newest object in daily/.
#
# The PRIVATE age key is needed to decrypt. It lives offline with the owner; mount it for the
# duration of the restore and remove it afterwards:
#   docker compose --env-file .env.prod -f compose.prod.yml run --rm \
#     -v /path/to/age-key.txt:/run/age-identity:ro backup restore.sh --verify latest
#
# Environment: the same PG* and R2_* variables as backup.sh, plus
#   AGE_IDENTITY_FILE   path of the private key inside the container (default /run/age-identity)
set -Eeuo pipefail

log() { printf '[restore %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

MODE=""; TARGET=""; KEY="latest"; OVERWRITE_LIVE=0
while (( $# > 0 )); do
  case "$1" in
    --verify) MODE="verify" ;;
    --into) MODE="into"; TARGET="${2:-}"; shift ;;
    --overwrite-live) OVERWRITE_LIVE=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) KEY="$1" ;;
  esac
  shift
done
[[ -n "$MODE" ]] || die "choose --verify or --into <database> (see --help)"

: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}" "${R2_BUCKET:?}"
: "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"
IDENTITY="${AGE_IDENTITY_FILE:-/run/age-identity}"
[[ -r "$IDENTITY" ]] || die "private age key not found at $IDENTITY (mount it with -v /path/key.txt:$IDENTITY:ro)"

R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID or R2_ENDPOINT}.r2.cloudflarestorage.com}"
export RCLONE_LOG_LEVEL=ERROR
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER="${R2_PROVIDER:-Cloudflare}"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
REMOTE="r2:${R2_BUCKET}"

# --- Which backup ---------------------------------------------------------------------------------
if [[ "$KEY" == "latest" ]]; then
  NAME="$(rclone lsf --files-only "${REMOTE}/daily" | grep -E '\.dump\.age$' | sort | tail -n 1)"
  [[ -n "$NAME" ]] || die "no backups found in ${R2_BUCKET}/daily"
  KEY="daily/${NAME}"
fi
[[ "$KEY" =~ ^(daily|weekly)/wasfa-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.dump\.age$ ]] || die "not a backup object name: $KEY"
COUNTS_KEY="${KEY%.dump.age}.counts.age"
log "using ${KEY}"

# --- Target database ------------------------------------------------------------------------------
if [[ "$MODE" == "verify" ]]; then
  TARGET="restore_check_$(date -u +%Y%m%d%H%M%S)"
fi
[[ "$TARGET" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "invalid database name"
if [[ "$TARGET" == "$PGDATABASE" && $OVERWRITE_LIVE -ne 1 ]]; then
  die "$TARGET is the live database. Restore into a new one, or pass --overwrite-live if you really mean it"
fi

psql_admin() { psql -X -qAt -v ON_ERROR_STOP=1 -d postgres "$@"; }
EXISTS="$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '${TARGET}'")"
if [[ -z "$EXISTS" ]]; then
  log "creating database ${TARGET}"
  psql_admin -c "CREATE DATABASE ${TARGET}"
elif [[ "$MODE" == "verify" ]]; then
  die "scratch database ${TARGET} already exists"
else
  log "restoring into existing database ${TARGET}"
fi

cleanup() {
  if [[ "$MODE" == "verify" && "${KEEP_SCRATCH:-0}" != "1" ]]; then
    if psql_admin -c "DROP DATABASE IF EXISTS ${TARGET} WITH (FORCE)" >/dev/null 2>&1; then
      log "scratch database ${TARGET} dropped"
    else
      log "could not drop ${TARGET}: drop it by hand"
    fi
  fi
}
trap cleanup EXIT

# --- Restore: download -> decrypt -> pg_restore, streamed -----------------------------------------
log "restoring (download, decrypt, load)"
rclone cat "${REMOTE}/${KEY}" \
  | age --decrypt --identity "$IDENTITY" \
  | pg_restore --no-owner --no-acl --exit-on-error --dbname "$TARGET"
log "restore finished"

# --- Verify against the manifest ------------------------------------------------------------------
log "comparing row counts with the backup manifest"
EXPECTED="$(rclone cat "${REMOTE}/${COUNTS_KEY}" | age --decrypt --identity "$IDENTITY")"
ACTUAL="$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$TARGET" -c "SELECT n.nspname || '.' || c.relname || '|' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','drizzle') ORDER BY 1")"

printf '%-40s %10s %10s  %s\n' TABLE BACKUP RESTORED RESULT
BAD=0
while IFS='|' read -r table want; do
  [[ -n "$table" ]] || continue
  got="$(grep -F "${table}|" <<<"$ACTUAL" | head -n 1 | cut -d'|' -f2 || true)"
  if [[ "$got" == "$want" ]]; then result="ok"; else result="MISMATCH"; BAD=$(( BAD + 1 )); fi
  printf '%-40s %10s %10s  %s\n' "$table" "$want" "${got:-missing}" "$result"
done <<<"$EXPECTED"
EXPECTED_N="$(grep -c . <<<"$EXPECTED" || true)"
ACTUAL_N="$(grep -c . <<<"$ACTUAL" || true)"
if (( EXPECTED_N == 0 )); then die "the manifest is empty"; fi
if (( ACTUAL_N != EXPECTED_N )); then log "table count differs: backup ${EXPECTED_N}, restored ${ACTUAL_N}"; BAD=$(( BAD + 1 )); fi

if (( BAD > 0 )); then
  KEEP_SCRATCH=1
  die "verification FAILED (${BAD} problem(s)); scratch database ${TARGET} kept for inspection"
fi
log "verification passed: ${EXPECTED_N} tables restored with identical row counts"
