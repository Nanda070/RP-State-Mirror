#!/usr/bin/env bash
# Mirror: bind a domain (or change the address) of the site.
#
#   sudo bash deploy/set-domain.sh mirror.example.com
#
# Before running: the domain's A record must point to this server's IP (check: dig +short <domain>).
# The script rewrites the address in .env and in the Caddy config, obtains the HTTPS certificate
# (Caddy does it on the first request) and restarts the dashboard and the bot.
# After it: add the new callback address in the Discord Developer Portal — the script prints it.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
DOMAIN="${1:-}"
[[ -n "$DOMAIN" ]] || die "Укажите домен: sudo bash $0 mirror.example.com"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%/*}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Некорректный домен: $DOMAIN"
[[ -f "$ENV_FILE" ]] || die "Нет $ENV_FILE — сначала выполните deploy/setup.sh"

say "Проверка DNS"
SERVER_IP=$(curl -fsS --max-time 10 https://api.ipify.org || true)
DOMAIN_IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 { print $1 }' || true)
echo "IP сервера: ${SERVER_IP:-неизвестен}; домен $DOMAIN указывает на: ${DOMAIN_IP:-никуда}"
if [[ -z "$DOMAIN_IP" || ( -n "$SERVER_IP" && "$DOMAIN_IP" != "$SERVER_IP" ) ]]; then
  warn "A-запись домена не указывает на этот сервер. Сертификат HTTPS не будет получен, пока DNS не обновится."
  warn "Если домен стоит за прокси (например, Cloudflare с оранжевым облаком) — это ожидаемо; иначе исправьте A-запись."
  [[ "${FORCE:-0}" == "1" ]] || die "Остановлено. Чтобы продолжить всё равно: FORCE=1 sudo bash $0 $DOMAIN"
fi

OLD_URL=$(env_get PUBLIC_BASE_URL)

say "Адрес в $ENV_FILE"
cp -p "$ENV_FILE" "$ENV_FILE.before-domain"
env_set PUBLIC_BASE_URL "https://$DOMAIN"
env_set OAUTH_REDIRECT_URL "https://$DOMAIN/api/auth/callback/discord"
echo "Было: ${OLD_URL:-не задано}; стало: https://$DOMAIN (прежний файл: $ENV_FILE.before-domain)"

say "Конфигурация Caddy"
install_caddyfile "$DOMAIN"
systemctl reload caddy

say "Перезапуск дашборда и бота"
systemctl restart $SERVICES
wait_for_site || die "дашборд не ответил (journalctl -u mirror-dashboard -n 80)"

say "Проверка HTTPS"
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null --max-time 10 "https://$DOMAIN/api/health"; then
    echo "https://$DOMAIN отвечает, сертификат получен."
    HTTPS_OK=1
    break
  fi
  sleep 3
done
[[ "${HTTPS_OK:-0}" == "1" ]] || warn "https://$DOMAIN пока не отвечает. Проверьте DNS и порты 80/443, затем: journalctl -u caddy -n 50"

cat <<NEXT

Осталось сделать в Discord Developer Portal (https://discord.com/developers/applications):
  OAuth2 → Redirects → добавить:
    https://$DOMAIN/api/auth/callback/discord
  (старый адрес можно удалить, когда убедитесь, что вход работает)

Все пользователи должны войти заново: сессии привязаны к адресу сайта.
Ссылки на веб-формы в новых сообщениях бота будут вести на новый адрес; уже опубликованные
сообщения со старым адресом нужно опубликовать заново из дашборда.
NEXT
