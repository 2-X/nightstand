#!/bin/bash
# Deletes Nightstand's settings, schedules and sleep data, then starts the
# server again with an empty database. Keeps the hardware socket path, which
# only the installer writes, so the server still reaches the Pod afterwards.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -uo pipefail

DATA_DIR=/persistent/free-sleep-data
SOCK_FILE="$DATA_DIR/dac_sock_path.txt"
WATCHDOG_MARK="$DATA_DIR/watchdog-trial"
SERVER_DIR=/home/dac/free-sleep/server
NPM=/home/dac/.volta/bin/npm

print_yellow() { echo -e "\033[0;33m$1\033[0m"; }

print_yellow "WARNING: This permanently deletes Nightstand's settings, schedules and sleep data in /persistent/free-sleep-data/."
print_yellow "Backups in /persistent/free-sleep-backups and /persistent/free-sleep-database-backups are kept; delete them too to remove all sleep data."
print_yellow "Nightstand starts again afterwards with empty settings."
read -r -p "Are you sure you want to continue? (y/N): " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Cancelled"
  exit 0
fi

SOCK_PATH=""
[ -f "$SOCK_FILE" ] && SOCK_PATH=$(cat "$SOCK_FILE")
# The watchdog's trial file is kept too, byte for byte, so a failed trial or
# an owner's --remove still keeps it off. Empty means a trial never finished.
MARK=""
[ ! -f "$WATCHDOG_MARK" ] || MARK="$(cat "$WATCHDOG_MARK"; printf x)"
STREAM_WAS_ACTIVE=$(systemctl is-active free-sleep-stream 2>/dev/null || true)
ARCHIVE_WAS_ACTIVE=$(systemctl is-active free-sleep-archive-raw.timer 2>/dev/null || true)

# Whatever happens below, the server and the services it had start again.
restart_services() {
  systemctl start free-sleep
  [ "$STREAM_WAS_ACTIVE" != active ] || systemctl restart free-sleep-stream
  [ "$ARCHIVE_WAS_ACTIVE" != active ] || systemctl start free-sleep-archive-raw.timer
}
trap restart_services EXIT

echo "Stopping Nightstand"
systemctl stop free-sleep-archive-raw.timer 2>/dev/null || true
systemctl stop free-sleep-stream 2>/dev/null || true
systemctl stop free-sleep || exit 1

echo "Deleting Nightstand data..."
rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR/lowdb" "$DATA_DIR/logs"
[ -z "$SOCK_PATH" ] || printf '%s\n' "$SOCK_PATH" > "$SOCK_FILE"
[ -z "$MARK" ] || printf '%s' "${MARK%x}" > "$WATCHDOG_MARK"
chown -R dac:dac "$DATA_DIR"
chmod 770 "$DATA_DIR"
chmod g+s "$DATA_DIR"

# server/package.json's migrate script applies the shipped migrations only.
echo "Creating an empty database..."
if ! sudo -u dac bash -c "cd '$SERVER_DIR' && '$NPM' run migrate"; then
  echo "WARNING: the database could not be created. Run fs-update or reinstall before relying on the Pod."
  exit 1
fi
echo "Done. Nightstand is starting with empty settings; set your schedules again."
