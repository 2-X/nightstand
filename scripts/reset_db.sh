#!/bin/bash
set -euo pipefail

print_yellow() {
  echo -e "\033[0;33m$1\033[0m"
}


print_yellow "WARNING: This will permanently delete all Nightstand biometric data!"
print_yellow "After deleting, this will recreate the DB"
read -p "Are you sure you want to continue? (y/N): " confirm


if [[ "$confirm" =~ ^[Yy]$ ]]; then
  systemctl stop free-sleep free-sleep-stream
  DATABASE="/persistent/free-sleep-data/free-sleep.db"
  if [ -f "$DATABASE" ]; then
    SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
    BACKUP="/persistent/free-sleep-database-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$-reset.db"
    python3 "$SCRIPT_DIR/sqlite-safety.py" checkpoint "$DATABASE"
    python3 "$SCRIPT_DIR/sqlite-safety.py" backup "$DATABASE" "$BACKUP"
    echo "Database backup saved to $BACKUP"
  fi
  rm -f /persistent/free-sleep-data/free-sleep.db-shm \
        /persistent/free-sleep-data/free-sleep.db-wal \
        /persistent/free-sleep-data/free-sleep.db-journal \
        /persistent/free-sleep-data/free-sleep.db

  su - dac -c "cd /home/dac/free-sleep/server && /home/dac/.volta/bin/npx dotenv -e .env.pod -- npx prisma migrate deploy && exit"

  systemctl start free-sleep free-sleep-stream
else
    echo "Cancelled"
fi
