#!/usr/bin/env bash
# Encrypted PostgreSQL backup to a private Cloudflare R2 bucket. Runs inside the `backup` image
# (docker compose run --rm backup), started nightly by the host's wasfa-backup.timer.
#
#   pg_dump  ->  age (public key)  ->  rclone rcat  ->  r2:<bucket>/daily/<timestamp>.dump.age
#
# The dump is streamed: the plain-text data never touches a disk. Only the PUBLIC key is on the
# server, so a stolen server or a stolen bucket cannot decrypt anything; the private key stays
# offline with the owner (see docs/DOCKER-GUIDE.md, "Backups").
#
# Per run it writes two objects, both encrypted:
#   daily/<ts>.dump.age     pg_dump custom format (zstd-compressed)
#   daily/<ts>.counts.age   row count of every table, taken in the SAME snapshot as the dump, so
#                           restore.sh --verify can prove a restore is complete
# Sundays (UTC) the pair is also copied to weekly/. Retention: 14 daily + 8 weekly.
#
# Environment
#   PGHOST PGUSER PGPASSWORD PGDATABASE   the database to back up (libpq variables)
#   R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
#   R2_ACCOUNT_ID                         builds https://<id>.r2.cloudflarestorage.com ...
#   R2_ENDPOINT                           ... unless set (tests use a local S3 server)
#   R2_PROVIDER                           rclone S3 provider, default Cloudflare
#   BACKUP_AGE_PUBLIC_KEY                 age recipient, age1...
#   BACKUP_KEEP_DAILY / BACKUP_KEEP_WEEKLY   defaults 14 / 8
#   BACKUP_WEEKLY_DAY                     ISO weekday of the weekly copy, 1=Mon .. 7=Sun (default 7)
#   BACKUP_ALERT_TELEGRAM_BOT_TOKEN / _CHAT_ID   optional failure alert
#   BACKUP_HEALTHCHECK_URL                optional dead-man's-switch URL (healthchecks.io style):
#                                         pinged on success, "<url>/fail" on failure, so a backup
#                                         that silently never runs is noticed too
set -Eeuo pipefail

KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
STEP="starting"
# Objects of THIS run that are not yet verified complete; removed again if the run fails, because a
# dump that stopped half way still encrypts and uploads "successfully" and would count as a backup.
PENDING_KEYS=()

log() { printf '[backup %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# --- Failure alert: says WHAT failed and where, never any data or secrets ----------------------
alert_failure() {
  local code="$1"
  log "FAILED during '${STEP}' (exit ${code})"
  if [[ -n "${BACKUP_ALERT_TELEGRAM_BOT_TOKEN:-}" && -n "${BACKUP_ALERT_TELEGRAM_CHAT_ID:-}" ]]; then
    curl -fsS -m 15 -o /dev/null \
      "https://api.telegram.org/bot${BACKUP_ALERT_TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${BACKUP_ALERT_TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=Wasfa backup FAILED at step '${STEP}' (exit ${code}) on $(date -u +%Y-%m-%dT%H:%MZ). Check: docker compose logs backup" \
      || log "could not send the Telegram alert"
  fi
  if [[ -n "${BACKUP_HEALTHCHECK_URL:-}" ]]; then
    curl -fsS -m 15 -o /dev/null "${BACKUP_HEALTHCHECK_URL%/}/fail" || true
  fi
}
discard_pending() {
  local key
  for key in "${PENDING_KEYS[@]}"; do
    rclone deletefile "${REMOTE:-r2:none}/${key}" >/dev/null 2>&1 || true
  done
}
on_error() {
  local code=$?
  discard_pending
  alert_failure "$code"
}
trap on_error ERR

# --- Configuration ------------------------------------------------------------------------------
: "${PGHOST:?PGHOST is required}" "${PGUSER:?PGUSER is required}" "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}" "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${BACKUP_AGE_PUBLIC_KEY:?BACKUP_AGE_PUBLIC_KEY is required}"
[[ "$BACKUP_AGE_PUBLIC_KEY" =~ ^age1[a-z0-9]{58}$ ]] || { STEP="config: BACKUP_AGE_PUBLIC_KEY is not an age public key"; false; }

R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID or R2_ENDPOINT}.r2.cloudflarestorage.com}"
export RCLONE_LOG_LEVEL=ERROR
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER="${R2_PROVIDER:-Cloudflare}"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
# A bucket-scoped token cannot create buckets; do not try.
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
REMOTE="r2:${R2_BUCKET}"

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
NAME="wasfa-${STAMP}"
DUMP_KEY="daily/${NAME}.dump.age"
COUNTS_KEY="daily/${NAME}.counts.age"

# --- One snapshot for both the dump and the row counts ------------------------------------------
STEP="opening a consistent snapshot"
coproc PSQL { psql -X -qAt -v ON_ERROR_STOP=1; }
printf 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n' >&"${PSQL[1]}"
IFS= read -r -t 30 SNAPSHOT <&"${PSQL[0]}"
[[ "$SNAPSHOT" =~ ^[0-9A-Fa-f-]+$ ]] || false

# --- Dump -> encrypt -> upload, streamed --------------------------------------------------------
STEP="dumping, encrypting and uploading the database"
log "writing ${DUMP_KEY}"
PENDING_KEYS=("$DUMP_KEY" "$COUNTS_KEY")
pg_dump --format=custom --compress=zstd:6 --no-owner --no-acl --snapshot="$SNAPSHOT" \
  | age --recipient "$BACKUP_AGE_PUBLIC_KEY" \
  | rclone rcat "${REMOTE}/${DUMP_KEY}"

# --- Row counts from the same snapshot ----------------------------------------------------------
STEP="recording row counts"
# xpath/query_to_xml is the portable way to run count(*) over every table in one statement.
printf '%s\n' "SELECT n.nspname || '.' || c.relname || '|' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','drizzle') ORDER BY 1;" "SELECT '__END__';" >&"${PSQL[1]}"
COUNTS=""
while IFS= read -r -t 60 line <&"${PSQL[0]}"; do
  [[ "$line" == "__END__" ]] && break
  COUNTS+="${line}"$'\n'
done
printf 'COMMIT;\n\\q\n' >&"${PSQL[1]}"
wait "$PSQL_PID" || true
[[ -n "$COUNTS" ]] || false
printf '%s' "$COUNTS" | age --recipient "$BACKUP_AGE_PUBLIC_KEY" | rclone rcat "${REMOTE}/${COUNTS_KEY}"

# --- Verify what landed in the bucket -----------------------------------------------------------
STEP="verifying the upload"
SIZE="$(rclone lsjson --files-only "${REMOTE}/daily" | jq -r --arg n "${NAME}.dump.age" '.[] | select(.Name == $n) | .Size')"
[[ "${SIZE:-0}" -ge 1024 ]] || false
PENDING_KEYS=()
log "uploaded ${DUMP_KEY} (${SIZE} bytes, encrypted)"

# --- Weekly copy (server-side, no data passes through this container) ---------------------------
if [[ "$(date -u +%u)" == "${BACKUP_WEEKLY_DAY:-7}" ]]; then
  STEP="copying to weekly/"
  rclone copyto "${REMOTE}/${DUMP_KEY}" "${REMOTE}/weekly/${NAME}.dump.age"
  rclone copyto "${REMOTE}/${COUNTS_KEY}" "${REMOTE}/weekly/${NAME}.counts.age"
  log "weekly copy written"
fi

# --- Retention ----------------------------------------------------------------------------------
# Keeps the newest N dumps per folder (names sort chronologically) and removes older dumps with
# their counts file. Refuses to delete anything unless MORE than N dumps exist, so an empty or
# failed listing can never wipe the bucket.
prune() {
  local folder="$1" keep="$2" listing total old key
  STEP="retention (${folder})"
  listing="$(rclone lsf --files-only "${REMOTE}/${folder}" | grep -E '\.dump\.age$' | sort || true)"
  total="$(printf '%s' "$listing" | grep -c . || true)"
  if (( total > keep )); then
    old="$(printf '%s\n' "$listing" | head -n $(( total - keep )))"
    while IFS= read -r key; do
      [[ "$key" =~ ^wasfa-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.dump\.age$ ]] || continue
      rclone deletefile "${REMOTE}/${folder}/${key}"
      rclone deletefile "${REMOTE}/${folder}/${key%.dump.age}.counts.age" || true
      log "pruned ${folder}/${key}"
    done <<<"$old"
  fi
  log "${folder}: $(( total > keep ? keep : total )) dumps kept"
}
prune daily "$KEEP_DAILY"
prune weekly "$KEEP_WEEKLY"

STEP="finished"
if [[ -n "${BACKUP_HEALTHCHECK_URL:-}" ]]; then
  curl -fsS -m 15 -o /dev/null "${BACKUP_HEALTHCHECK_URL}" || log "healthcheck ping failed (backup itself is fine)"
fi
log "done: ${NAME}"
