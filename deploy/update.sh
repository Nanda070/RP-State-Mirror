#!/usr/bin/env bash
# Mirror: update of the whole server with one command.
#
#   sudo bash deploy/update.sh            update: maintenance on → backup → git pull → dependencies →
#                                         migrations → build → restart → health checks → maintenance off
#   sudo bash deploy/update.sh status     maintenance state, services, bot heartbeat, backups, version
#   sudo bash deploy/update.sh enable ["reason"]   turn maintenance on by hand
#   sudo bash deploy/update.sh disable    turn maintenance off
#   sudo bash deploy/update.sh start | stop | restart   the bot and the dashboard
#   sudo bash deploy/update.sh logs [bot|dashboard]     follow the logs
#   sudo bash deploy/update.sh backup     make a backup right now
#   sudo bash deploy/update.sh rollback   return the code to the version before the last update
#
# If a step fails, the script stops, says where, and LEAVES MAINTENANCE ON: the site shows the
# «технические работы» page instead of a half-updated system. Fix the cause and run it again,
# or run `rollback`.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

PREVIOUS_FILE="$APP_ROOT/.deploy-previous-commit"
STEP="подготовка"

on_error() {
  local code=$?
  printf '\nОБНОВЛЕНИЕ ОСТАНОВЛЕНО на шаге: %s (код %s)\n' "$STEP" "$code" >&2
  cat >&2 <<HELP
Технические работы остаются включёнными.
  Журналы:        sudo bash $0 logs bot   |   sudo bash $0 logs dashboard
  Повторить:      sudo bash $0
  Откатить код:   sudo bash $0 rollback
  Открыть сайт:   sudo bash $0 disable
HELP
  exit "$code"
}

step() {
  STEP="$1"
  say "$1"
}

current_commit() { as_app "git rev-parse --short HEAD"; }

build_and_migrate() {
  step "Зависимости"
  as_app "pnpm install --frozen-lockfile"

  step "База данных и хранилище (Docker)"
  (cd "$APP_ROOT" && docker compose up -d --build)
  wait_for_postgres || die "база данных не ответила за 2 минуты (docker compose logs postgres)"

  step "Клиент базы данных"
  as_app "pnpm db:generate"

  step "Миграции базы данных"
  as_app "pnpm db:deploy"

  step "Сборка"
  as_app "pnpm build"
}

restart_and_check() {
  step "Перезапуск бота и дашборда"
  systemctl restart $SERVICES

  step "Проверка: сайт отвечает"
  wait_for_site || die "дашборд не ответил за 2 минуты (journalctl -u mirror-dashboard -n 80)"

  step "Проверка: бот на связи"
  maintenance wait-bot 120
}

deploy() {
  [[ -z "$(missing_secrets)" ]] || die "В $ENV_FILE не заполнены: $(missing_secrets)"
  trap on_error ERR

  step "Включение технических работ"
  # On the very first run there is no build yet, so there is nothing to switch.
  if [[ -f "$APP_ROOT/packages/core/dist/index.js" ]]; then
    maintenance on "'${MAINT_MSG:-Обновление системы. Вернёмся через несколько минут.}'"
  else
    warn "сборки ещё нет — пропускаю"
  fi

  step "Резервная копия перед обновлением"
  (cd "$APP_ROOT" && docker compose exec -T backup backup.sh) || warn "копия не создана — продолжаю без неё"

  step "Получение новой версии"
  current_commit > "$PREVIOUS_FILE"
  chown "$APP_USER:$APP_USER" "$PREVIOUS_FILE"
  # After a rollback the checkout is detached: return to the branch before pulling.
  as_app "git symbolic-ref -q HEAD >/dev/null || git checkout ${DEPLOY_BRANCH:-main}"
  as_app "git pull --ff-only"
  echo "Было: $(cat "$PREVIOUS_FILE"), стало: $(current_commit)"

  build_and_migrate
  restart_and_check

  step "Выключение технических работ"
  maintenance off

  trap - ERR
  say "Обновление завершено: версия $(current_commit)"
  maintenance status
}

rollback() {
  [[ -f "$PREVIOUS_FILE" ]] || die "Нет записи о предыдущей версии: откатывать нечего."
  local target
  target=$(cat "$PREVIOUS_FILE")
  trap on_error ERR

  step "Включение технических работ"
  maintenance on "'Откат обновления.'" || warn "не удалось включить техработы — продолжаю"

  step "Возврат кода к версии $target"
  as_app "git checkout --detach $target"

  # Migrations are not undone: they only add to the schema, and the older code keeps working with it.
  # If an update changed data incompatibly, restore the dump made before it (docs/DEPLOYMENT.md).
  build_and_migrate
  restart_and_check

  step "Выключение технических работ"
  maintenance off
  trap - ERR
  say "Код возвращён к версии $target. Следующий запуск update.sh сам вернётся на основную ветку и подтянет новую версию."
}

status() {
  echo "Версия: $(current_commit) ($(as_app "git log -1 --format=%cd --date=format:'%d.%m.%Y %H:%M'"))"
  echo "Адрес:  $(env_get PUBLIC_BASE_URL)"
  for unit in $SERVICES caddy docker; do
    printf '  %-18s %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || true)"
  done
  maintenance status || warn "не удалось прочитать состояние из базы"
}

require_root

case "${1:-deploy}" in
  deploy | update) deploy ;;
  rollback) rollback ;;
  status) status ;;
  enable) maintenance on "'${2:-Технические работы.}'" ;;
  disable) maintenance off ;;
  start)
    [[ -z "$(missing_secrets)" ]] || die "В $ENV_FILE не заполнены: $(missing_secrets)"
    # Idempotent: creates the factions, default settings and the super admin accounts from .env.
    as_app "pnpm db:seed"
    systemctl start $SERVICES
    wait_for_site || die "дашборд не ответил (journalctl -u mirror-dashboard -n 80)"
    maintenance wait-bot 120
    ;;
  stop) systemctl stop $SERVICES ;;
  restart)
    systemctl restart $SERVICES
    wait_for_site || die "дашборд не ответил (journalctl -u mirror-dashboard -n 80)"
    maintenance wait-bot 120
    ;;
  logs)
    case "${2:-}" in
      bot) journalctl -u mirror-bot -f -n 100 ;;
      dashboard) journalctl -u mirror-dashboard -f -n 100 ;;
      *) journalctl -u mirror-bot -u mirror-dashboard -f -n 100 ;;
    esac
    ;;
  backup) (cd "$APP_ROOT" && docker compose exec -T backup backup.sh) ;;
  *)
    echo "usage: $0 [deploy|status|enable [reason]|disable|start|stop|restart|logs [bot|dashboard]|backup|rollback]" >&2
    exit 1
    ;;
esac
