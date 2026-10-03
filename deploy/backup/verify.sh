#!/bin/sh
# Proves that a dump restores: loads it into a scratch database, compares row counts with the live
# one and drops the scratch database. Nothing in the live database is touched.
#
#   verify.sh            newest dump
#   verify.sh <file>     a specific dump (name or path)
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
SCRATCH="mirror_restore_check"

pick_dump() {
  if [ -n "${1:-}" ]; then
    [ -f "$1" ] && { echo "$1"; return; }
    [ -f "$BACKUP_DIR/db/$1" ] && { echo "$BACKUP_DIR/db/$1"; return; }
    echo "Dump not found: $1" >&2
    exit 1
  fi
  newest=$(ls -1t "$BACKUP_DIR"/db/mirror-*.dump 2>/dev/null | head -n 1)
  [ -n "$newest" ] || { echo "No dumps in $BACKUP_DIR/db" >&2; exit 1; }
  echo "$newest"
}

counts() {
  # Exact row count of every table in the public schema of database $1.
  psql -d "$1" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT format('SELECT %L || ''='' || count(*) FROM %I;', tablename, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
SQL
}

DUMP=$(pick_dump "${1:-}")
echo "Verifying $DUMP"

psql -d postgres -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
trap 'psql -d postgres -q -c "DROP DATABASE IF EXISTS $SCRATCH"' EXIT

pg_restore --no-owner --no-privileges --exit-on-error -d "$SCRATCH" "$DUMP"

RESTORED=$(counts "$SCRATCH")
LIVE=$(counts "$PGDATABASE")
TABLES=$(echo "$RESTORED" | wc -l | tr -d ' ')
ROWS=$(echo "$RESTORED" | awk -F= '{ sum += $2 } END { print sum + 0 }')

echo "Restored: $TABLES tables, $ROWS rows."
if [ "$RESTORED" = "$LIVE" ]; then
  echo "Row counts match the live database exactly."
else
  echo "Tables that changed since the dump (dump -> live); expected when the system was in use:"
  echo "$RESTORED" > /tmp/restored.txt
  echo "$LIVE" > /tmp/live.txt
  diff /tmp/restored.txt /tmp/live.txt | grep '^[-+][a-z_]' || true
fi
echo "OK: the dump restores cleanly."
