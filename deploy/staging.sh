#!/usr/bin/env bash
# Mirror: the test copy of the site and the bot on the same server, in /opt/mirror-staging.
# Its own database, file storage, backups, systemd services, address and Discord bot: nothing it
# does reaches the real installation. Try an update here first, then run it on the real one.
#
#   sudo bash deploy/staging.sh setup                 first installation (DOMAIN=…, DEPLOY_BRANCH=… as for setup.sh)
#   sudo bash deploy/staging.sh update                update of the copy (same steps as update.sh)
#   sudo bash deploy/staging.sh status | start | stop | restart | logs [bot|dashboard] | backup | rollback
#   sudo bash deploy/staging.sh enable ["reason"] | disable    maintenance of the copy
#   sudo bash deploy/staging.sh domain test.mirror.example.com address of the copy
#
# Remove the copy: sudo bash deploy/staging.sh stop, then see docs/DEPLOYMENT.md, section 12.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export INSTANCE=staging

COMMAND="${1:-status}"
shift || true
case "$COMMAND" in
  setup) exec bash "$SCRIPT_DIR/setup.sh" "$@" ;;
  domain) exec bash "$SCRIPT_DIR/set-domain.sh" "$@" ;;
  update | deploy) exec bash "$SCRIPT_DIR/update.sh" deploy ;;
  *) exec bash "$SCRIPT_DIR/update.sh" "$COMMAND" "$@" ;;
esac
