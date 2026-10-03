#!/bin/sh
# Scheduler of the backup container: one backup a day at BACKUP_AT (container time zone),
# plus one right after start when the newest dump is older than a day.
set -eu

BACKUP_AT="${BACKUP_AT:-04:00}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

fresh_dump_exists() {
  [ -n "$(find "$BACKUP_DIR/db" -name 'mirror-*.dump' -mmin -1440 2>/dev/null | head -n 1)" ]
}

seconds_until() {
  now=$(date +%s)
  target=$(date -d "$(date +%Y-%m-%d) $1:00" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo $((target - now))
}

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/storage"

if ! fresh_dump_exists; then
  log "No dump from the last 24 hours: backing up now."
  backup.sh || log "Backup failed; next attempt at $BACKUP_AT."
fi

while true; do
  wait=$(seconds_until "$BACKUP_AT")
  log "Next backup in $((wait / 60)) min (at $BACKUP_AT)."
  sleep "$wait"
  backup.sh || log "Backup failed; next attempt tomorrow at $BACKUP_AT."
done
