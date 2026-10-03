#!/bin/sh
# Restores the system from a backup. DESTRUCTIVE: the live database is replaced by the dump.
# Stop the bot and the dashboard first, start them again afterwards.
#
#   restore.sh --yes                 newest dump + storage copy
#   restore.sh --yes <file>          a specific dump (name or path) + storage copy
#   restore.sh --yes --db-only       database only
#   restore.sh --yes --storage-only  files only
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
CONFIRMED=no
DO_DB=yes
DO_STORAGE=yes
FILE=""

for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRMED=yes ;;
    --db-only) DO_STORAGE=no ;;
    --storage-only) DO_DB=no ;;
    -*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *) FILE="$arg" ;;
  esac
done

if [ "$CONFIRMED" != yes ]; then
  echo "This replaces the live database with a backup. Re-run with --yes to confirm." >&2
  exit 2
fi

if [ "$DO_DB" = yes ]; then
  if [ -n "$FILE" ]; then
    [ -f "$FILE" ] || FILE="$BACKUP_DIR/db/$FILE"
  else
    FILE=$(ls -1t "$BACKUP_DIR"/db/mirror-*.dump 2>/dev/null | head -n 1)
  fi
  [ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Dump not found." >&2; exit 1; }

  # Safety net: the state being replaced is dumped first.
  SAFETY="$BACKUP_DIR/db/before-restore-$(date +%Y%m%d-%H%M%S).dump"
  echo "Saving the current database to $SAFETY"
  pg_dump --format=custom --no-owner --no-privileges --file="$SAFETY"

  echo "Restoring $FILE into $PGDATABASE"
  psql -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public"
  pg_restore --no-owner --no-privileges --exit-on-error -d "$PGDATABASE" "$FILE"
  echo "Database restored."
fi

if [ "$DO_STORAGE" = yes ]; then
  if [ -n "${S3_BUCKET:-}" ] && [ -d "$BACKUP_DIR/storage/$S3_BUCKET" ]; then
    echo "Restoring files into s3://$S3_BUCKET"
    AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
      AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}" \
      aws s3 sync "$BACKUP_DIR/storage/$S3_BUCKET" "s3://$S3_BUCKET" \
      --endpoint-url "$S3_ENDPOINT" --only-show-errors
    echo "Files restored."
  else
    echo "No storage copy to restore: skipped."
  fi
fi

echo "Done. Start the bot and the dashboard."
