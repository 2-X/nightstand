#!/bin/bash
set -euo pipefail

print_yellow() {
  echo -e "\033[0;33m$1\033[0m"
}

SERVICES_DB=/persistent/free-sleep-data/lowdb/servicesDB.json

# The stream starts again only while Biometrics is on in the app.
biometrics_on() {
  python3 -c 'import json, sys; sys.exit(0 if json.load(open(sys.argv[1]))["biometrics"]["enabled"] is True else 1)' "$SERVICES_DB" 2>/dev/null
}
start_services() {
  systemctl start free-sleep
  if biometrics_on; then
    systemctl start free-sleep-stream
  fi
}


print_yellow "WARNING: This will permanently delete all Nightstand biometric data!"
print_yellow "After deleting, this will recreate the DB"
read -p "Are you sure you want to continue? (y/N): " confirm


if [[ "$confirm" =~ ^[Yy]$ ]]; then
  # Recovery also runs when checkpoint, backup, or migration exits under set -e.
  restart_on_failure() {
    result=$?
    if [ "$result" -ne 0 ]; then
      start_services || true
    fi
  }
  trap restart_on_failure EXIT
  systemctl stop free-sleep free-sleep-stream
  DATABASE="/persistent/free-sleep-data/free-sleep.db"
  if [ -f "$DATABASE" ]; then
    SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
    BACKUP="/persistent/free-sleep-database-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$-reset.db"
    python3 "$SCRIPT_DIR/sqlite-safety.py" checkpoint "$DATABASE"
    python3 "$SCRIPT_DIR/sqlite-safety.py" backup "$DATABASE" "$BACKUP"
    echo "Database backup saved to $BACKUP"
    bash "$SCRIPT_DIR/prune_db_snapshots.sh" /persistent/free-sleep-database-backups "$BACKUP" || true
  fi
  rm -f /persistent/free-sleep-data/free-sleep.db-shm \
        /persistent/free-sleep-data/free-sleep.db-wal \
        /persistent/free-sleep-data/free-sleep.db-journal \
        /persistent/free-sleep-data/free-sleep.db

  su - dac -c "cd /home/dac/free-sleep/server && /home/dac/.volta/bin/npx dotenv -e .env.pod -- npx prisma migrate deploy && exit"

  start_services
else
    echo "Cancelled"
fi
