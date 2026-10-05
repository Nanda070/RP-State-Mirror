#!/usr/bin/env bash
# Shared by setup.sh, update.sh and set-domain.sh. Sourced, never run.

say() { printf '\n==> %s\n' "$*"; }
warn() { printf 'ВНИМАНИЕ: %s\n' "$*" >&2; }
die() { printf 'ОШИБКА: %s\n' "$*" >&2; exit 1; }

# Which installation the scripts work on: the real one (`mirror`, /opt/mirror) or the test copy
# (`mirror-staging`, /opt/mirror-staging) with its own database, storage, services, address and bot.
# INSTANCE=staging selects the copy; a script started from inside /opt/mirror-staging works on it.
_LIB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "${INSTANCE:-}" in
  "") if [[ "$_LIB_ROOT" == "/opt/mirror-staging" ]]; then INSTANCE=mirror-staging; else INSTANCE=mirror; fi ;;
  staging | mirror-staging) INSTANCE=mirror-staging ;;
  mirror | production) INSTANCE=mirror ;;
  *) die "Неизвестная установка INSTANCE=$INSTANCE (mirror или staging)" ;;
esac

if [[ "$INSTANCE" == "mirror-staging" ]]; then
  STAGING=1
  # The copy listens next to the real installation, on ports of its own.
  DASHBOARD_PORT=3001
  POSTGRES_PORT=5433
  S3_PORT=9001
else
  STAGING=0
  DASHBOARD_PORT=3000
  POSTGRES_PORT=5432
  S3_PORT=9000
fi

APP_ROOT="${APP_ROOT:-/opt/$INSTANCE}"
APP_USER="${APP_USER:-mirror}"
ENV_FILE="$APP_ROOT/.env"
SERVICES="$INSTANCE-bot $INSTANCE-dashboard"

# Waits until PostgreSQL in Docker accepts connections. A changed service definition recreates the
# container, and the next step (migrations) must not start before the database is back.
wait_for_postgres() {
  local attempt
  for attempt in $(seq 1 60); do
    (cd "$APP_ROOT" && docker compose exec -T postgres pg_isready -U mirror -d mirror >/dev/null 2>&1) && return 0
    sleep 2
  done
  return 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Запустите через sudo."
}

# Runs a command as the application user inside the project folder.
as_app() {
  sudo -u "$APP_USER" -H bash -c "cd '$APP_ROOT' && $*"
}

env_get() {
  # Value of KEY from the env file, without quotes; empty when absent.
  local line
  line=$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n 1) || true
  line="${line#*=}"
  line="${line%\"}"
  printf '%s' "${line#\"}"
}

env_set() {
  # Sets KEY=VALUE in the env file, replacing the line when it exists.
  local key="$1" value="$2"
  if grep -qE "^$key=" "$ENV_FILE"; then
    sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

# Names of the required values that are still empty.
missing_secrets() {
  local key missing=""
  for key in DISCORD_BOT_TOKEN DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET SUPER_ADMIN_USER_IDS; do
    [[ -n "$(env_get "$key")" ]] || missing="$missing $key"
  done
  printf '%s' "${missing# }"
}

maintenance() {
  # on [reason] | off | status | wait-bot [seconds]
  as_app "node --env-file=.env scripts/maintenance.mjs $*"
}

wait_for_site() {
  # The dashboard answers /api/health once it has started and reached the database.
  local attempt
  for attempt in $(seq 1 40); do
    if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$DASHBOARD_PORT/api/health"; then
      echo "Сайт отвечает."
      return 0
    fi
    sleep 3
  done
  return 1
}

# Caddy serves every installation from its own file in /etc/caddy/sites; the main config only
# imports them. A server set up before the test copy existed had its one site right in the main
# config: that site moves into sites/mirror.caddy the first time this runs.
ensure_caddy_sites() {
  mkdir -p /etc/caddy/sites
  if ! grep -qxF 'import /etc/caddy/sites/*.caddy' /etc/caddy/Caddyfile 2>/dev/null; then
    if grep -q 'reverse_proxy' /etc/caddy/Caddyfile 2>/dev/null && [[ ! -f /etc/caddy/sites/mirror.caddy ]]; then
      cp /etc/caddy/Caddyfile /etc/caddy/sites/mirror.caddy
    fi
    printf '%s\n' '# Sites of Mirror, one file per installation (written by deploy/lib.sh).' \
      'import /etc/caddy/sites/*.caddy' > /etc/caddy/Caddyfile
  fi
}

install_caddyfile() {
  # $1 = domain
  local robots="# indexed"
  # The test copy is not for search engines.
  if [[ "$STAGING" == "1" ]]; then robots='X-Robots-Tag "noindex, nofollow"'; fi
  ensure_caddy_sites
  sed -e "s|__DOMAIN__|$1|g" -e "s|__APP_ROOT__|$APP_ROOT|g" -e "s|__PORT__|$DASHBOARD_PORT|g" \
    -e "s|__INSTANCE__|$INSTANCE|g" -e "s|# __ROBOTS__|$robots|" \
    "$APP_ROOT/deploy/caddy/Caddyfile" > "/etc/caddy/sites/$INSTANCE.caddy"
  mkdir -p /var/log/caddy
  chown caddy:caddy /var/log/caddy 2>/dev/null || true
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
}

# systemd units of this installation from the templates in deploy/systemd.
install_units() {
  local unit target
  for unit in bot dashboard; do
    target="/etc/systemd/system/$INSTANCE-$unit.service"
    sed -e "s|/opt/mirror|$APP_ROOT|g" -e "s|^User=mirror|User=$APP_USER|" -e "s|^Group=mirror|Group=$APP_USER|" \
      -e "s|--port 3000|--port $DASHBOARD_PORT|" -e "s|127.0.0.1:3000|127.0.0.1:$DASHBOARD_PORT|" \
      "$APP_ROOT/deploy/systemd/mirror-$unit.service" > "$target"
    if [[ "$STAGING" == "1" ]]; then
      sed -i "s|^Description=Mirror|Description=Mirror (тестовая копия)|" "$target"
    fi
  done
  systemctl daemon-reload
  systemctl enable $SERVICES
}

# Branch the installation follows: DEPLOY_BRANCH from the environment or from .env, else main.
deploy_branch() {
  local branch="${DEPLOY_BRANCH:-}"
  [[ -n "$branch" ]] || branch=$(env_get DEPLOY_BRANCH)
  printf '%s' "${branch:-main}"
}
