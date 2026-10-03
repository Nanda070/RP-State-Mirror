#!/bin/sh
# One backup: a database dump and an incremental copy of the file storage.
#
#   /backups/db/mirror-YYYYMMDD-HHMMSS.dump   pg_dump custom format, kept BACKUP_KEEP_DAYS days
#   /backups/storage/<bucket>/…               mirror of the bucket; objects are only ever added
#
# The project never deletes files, so the storage mirror is a superset of the bucket on any day
# and does not need daily snapshots. The result is reported to the database (status page).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP=$(date +%Y%m%d-%H%M%S)
DUMP="$BACKUP_DIR/db/mirror-$STAMP.dump"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

report() {
  # $1 = ok|failed, $2 = detail. Never fails the backup itself.
  psql -v ON_ERROR_STOP=1 -q -v state="$1" -v detail="$2" -v dump="$(basename "$DUMP")" <<'SQL' || true
INSERT INTO service_heartbeats (service, at, meta)
VALUES ('backup', now(), jsonb_build_object('state', :'state', 'detail', :'detail', 'dump', :'dump'))
ON CONFLICT (service) DO UPDATE SET at = EXCLUDED.at, meta = EXCLUDED.meta;
SQL
}

fail() {
  log "FAILED: $1"
  rm -f "$DUMP.partial"
  report failed "$1"
  exit 1
}

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/storage"

log "Database dump -> $DUMP"
pg_dump --format=custom --no-owner --no-privileges --file="$DUMP.partial" || fail "pg_dump"
# A dump that cannot be listed is not a backup.
pg_restore --list "$DUMP.partial" >/dev/null || fail "dump is unreadable"
mv "$DUMP.partial" "$DUMP"
DUMP_SIZE=$(du -h "$DUMP" | cut -f1)

if [ -n "${S3_BUCKET:-}" ] && [ -n "${S3_ENDPOINT:-}" ]; then
  log "Storage copy: s3://$S3_BUCKET -> $BACKUP_DIR/storage/$S3_BUCKET"
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}" \
    aws s3 sync "s3://$S3_BUCKET" "$BACKUP_DIR/storage/$S3_BUCKET" \
    --endpoint-url "$S3_ENDPOINT" --only-show-errors || fail "storage copy"
  FILES=$(find "$BACKUP_DIR/storage/$S3_BUCKET" -type f | wc -l | tr -d ' ')
else
  log "Storage is not configured (S3_ENDPOINT / S3_BUCKET): skipped."
  FILES=0
fi

# Retention applies to dumps only; the newest one is always kept.
find "$BACKUP_DIR/db" \( -name 'mirror-*.dump' -o -name 'before-restore-*.dump' \) -mtime +"$KEEP_DAYS" ! -name "$(basename "$DUMP")" -delete
find "$BACKUP_DIR/db" -name '*.partial' -mmin +120 -delete
KEPT=$(find "$BACKUP_DIR/db" -name 'mirror-*.dump' | wc -l | tr -d ' ')

log "Done: dump $DUMP_SIZE, dumps kept: $KEPT, files in storage copy: $FILES."
report ok "дамп $DUMP_SIZE, копий: $KEPT, файлов: $FILES"
