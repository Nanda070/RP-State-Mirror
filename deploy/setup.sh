#!/usr/bin/env bash
# Mirror: first-time setup of an Ubuntu 22.04 / 24.04 server. One command, safe to run again.
#
#   sudo bash deploy/setup.sh
#
# Optional variables:
#   DOMAIN=mirror.example.com   site address; without it a temporary <ip>.sslip.io address is used
#   REPO_URL=https://github.com/<owner>/<repo>.git   clone from here when the code is not on the server yet
#   APP_ROOT=/opt/mirror  APP_USER=mirror
#
# What it does: system packages, Node.js 22, pnpm, Docker, Caddy, the application user, the .env file
# with generated secrets, the database and file storage in Docker, the build, systemd units,
# the reverse proxy with HTTPS and the firewall. Secrets you must type in yourself are listed at the end.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
export DEBIAN_FRONTEND=noninteractive

say "Системные пакеты"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git rsync openssl ufw debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt 22 ]]; then
  say "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "node $(node -v)"

if ! command -v docker >/dev/null 2>&1; then
  say "Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version

if ! command -v caddy >/dev/null 2>&1; then
  say "Caddy (обратный прокси с автоматическим HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

say "Пользователь приложения $APP_USER"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_ROOT" --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

say "Код в $APP_ROOT"
if [[ ! -f "$APP_ROOT/package.json" ]]; then
  mkdir -p "$APP_ROOT"
  if [[ -n "${REPO_URL:-}" ]]; then
    git clone "$REPO_URL" "$APP_ROOT"
  elif [[ -f "$SOURCE_ROOT/package.json" && "$SOURCE_ROOT" != "$APP_ROOT" ]]; then
    # The repository was uploaded next to this script: move a copy into place, history included.
    rsync -a --exclude node_modules --exclude .next --exclude dist --exclude '.env' "$SOURCE_ROOT"/ "$APP_ROOT"/
  else
    die "Кода нет в $APP_ROOT. Укажите REPO_URL=… или загрузите репозиторий на сервер и запустите скрипт из него."
  fi
fi
chown -R "$APP_USER:$APP_USER" "$APP_ROOT"
# git refuses to work in a folder owned by another user unless told it is safe.
git config --system --add safe.directory "$APP_ROOT" 2>/dev/null || true

PNPM_VERSION=$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$APP_ROOT/package.json")
if ! command -v pnpm >/dev/null 2>&1 || [[ "$(pnpm -v)" != "$PNPM_VERSION" ]]; then
  say "pnpm $PNPM_VERSION"
  npm install -g "pnpm@$PNPM_VERSION"
fi

say "Адрес сайта"
if [[ -z "${DOMAIN:-}" && -f "$ENV_FILE" ]]; then
  # Re-run: keep the address that is already configured.
  DOMAIN=$(env_get PUBLIC_BASE_URL | sed -E 's|^https?://||; s|/.*$||')
fi
if [[ -z "${DOMAIN:-}" ]]; then
  PUBLIC_IP=$(curl -fsS --max-time 10 https://api.ipify.org || true)
  [[ -n "$PUBLIC_IP" ]] || die "Не удалось определить внешний IP. Запустите с DOMAIN=ваш.домен."
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
  echo "Домен не задан — используется временный адрес $DOMAIN (смена: deploy/set-domain.sh)."
fi
echo "Сайт: https://$DOMAIN"

say "Файл окружения $ENV_FILE"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$APP_ROOT/deploy/env.production.example" "$ENV_FILE"
  DB_PASSWORD=$(openssl rand -hex 24)
  sed -i "s|__DOMAIN__|$DOMAIN|g" "$ENV_FILE"
  env_set SESSION_SECRET "$(openssl rand -hex 32)"
  env_set POSTGRES_PASSWORD "$DB_PASSWORD"
  env_set DATABASE_URL "postgresql://mirror:$DB_PASSWORD@127.0.0.1:5432/mirror"
  env_set S3_SECRET_KEY "$(openssl rand -hex 24)"
  echo "Создан. Секреты базы, хранилища и сессий сгенерированы."
else
  echo "Уже есть — не трогаю."
fi
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

say "База данных, хранилище файлов и резервные копии (Docker)"
(cd "$APP_ROOT" && docker compose up -d --build)
echo "Жду готовности PostgreSQL…"
for _ in $(seq 1 30); do
  (cd "$APP_ROOT" && docker compose exec -T postgres pg_isready -U mirror -d mirror >/dev/null 2>&1) && break
  sleep 2
done

say "Зависимости, миграции базы, сборка"
as_app "pnpm install --frozen-lockfile"
as_app "pnpm db:generate"
as_app "pnpm db:deploy"
as_app "pnpm build"
as_app "pnpm db:seed"

say "Службы systemd"
for unit in mirror-bot mirror-dashboard; do
  sed -e "s|/opt/mirror|$APP_ROOT|g" -e "s|^User=mirror|User=$APP_USER|" -e "s|^Group=mirror|Group=$APP_USER|" \
    "$APP_ROOT/deploy/systemd/$unit.service" > "/etc/systemd/system/$unit.service"
done
systemctl daemon-reload
systemctl enable $SERVICES

say "Обратный прокси Caddy"
install_caddyfile "$DOMAIN"
systemctl enable --now caddy
systemctl reload caddy

say "Файрвол"
# Keep the port this SSH session uses open, whatever it is, before the firewall turns on.
SSH_PORT=$(sshd -T 2>/dev/null | awk '/^port / { print $2; exit }')
ufw allow "${SSH_PORT:-22}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

MISSING=$(missing_secrets)
if [[ -z "$MISSING" ]]; then
  say "Запуск"
  systemctl restart $SERVICES
  wait_for_site || warn "Сайт пока не отвечает: journalctl -u mirror-dashboard -n 50"
  maintenance status || true
fi

cat <<DONE

Готово.
  Сайт:              https://$DOMAIN
  Папка проекта:     $APP_ROOT
  Файл настроек:     $ENV_FILE

DONE
if [[ -n "$MISSING" ]]; then
  cat <<NEXT
Осталось сделать вручную:
  1. Вписать в $ENV_FILE значения: $MISSING
       sudo nano $ENV_FILE
  2. В Discord Developer Portal → OAuth2 → Redirects добавить:
       https://$DOMAIN/api/auth/callback/discord
     В разделе Bot включить «Server Members Intent».
  3. Запустить:
       sudo bash $APP_ROOT/deploy/update.sh start

NEXT
else
  cat <<NEXT
Проверьте, что в Discord Developer Portal → OAuth2 → Redirects есть:
  https://$DOMAIN/api/auth/callback/discord

Обновление одной командой:  sudo bash $APP_ROOT/deploy/update.sh
Состояние:                  sudo bash $APP_ROOT/deploy/update.sh status
NEXT
fi
