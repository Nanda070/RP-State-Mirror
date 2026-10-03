#!/usr/bin/env bash
# Shared by setup.sh, update.sh and set-domain.sh. Sourced, never run.

APP_ROOT="${APP_ROOT:-/opt/mirror}"
APP_USER="${APP_USER:-mirror}"
ENV_FILE="$APP_ROOT/.env"
SERVICES="mirror-bot mirror-dashboard"

say() { printf '\n==> %s\n' "$*"; }
warn() { printf 'ВНИМАНИЕ: %s\n' "$*" >&2; }
die() { printf 'ОШИБКА: %s\n' "$*" >&2; exit 1; }

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
    if curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:3000/api/health; then
      echo "Сайт отвечает."
      return 0
    fi
    sleep 3
  done
  return 1
}

install_caddyfile() {
  # $1 = domain
  sed -e "s|__DOMAIN__|$1|g" -e "s|__APP_ROOT__|$APP_ROOT|g" \
    "$APP_ROOT/deploy/caddy/Caddyfile" > /etc/caddy/Caddyfile
  mkdir -p /var/log/caddy
  chown caddy:caddy /var/log/caddy 2>/dev/null || true
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
}
