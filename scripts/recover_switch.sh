#!/bin/bash
# Restores uncommitted switches offline, before systemd releases writer startup.
set -euo pipefail
TRANSACTIONS="${NIGHTSTAND_TRANSACTION_ROOT:-/persistent/free-sleep-maintenance/nightstand-transactions}"
# Ordinary startup needs no Python, service state or maintenance lock.
HAS_JOURNAL=no
for journal in "$TRANSACTIONS"/*/journal.json; do
  if [ -e "$journal" ] || [ -L "$journal" ]; then HAS_JOURNAL=yes; break; fi
done
if [ "$HAS_JOURNAL" = no ]; then
  if [ -e "$TRANSACTIONS" ] && { [ ! -d "$TRANSACTIONS" ] || [ ! -r "$TRANSACTIONS" ] || [ ! -x "$TRANSACTIONS" ]; }; then
    echo 'Warning: switch journals could not be inspected; allowing startup without a known journal' >&2
  fi
  exit 0
fi
RECOVERY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$RECOVERY_DIR/recover_switch.py"
OPERATION_LOCK="${NIGHTSTAND_OPERATION_LOCK:-/run/lock/free-sleep-operation.lock}"
if [ -z "${NIGHTSTAND_OPERATION_LOCK:-}" ] && [ ! -d /run/lock ]; then
  OPERATION_LOCK=/tmp/free-sleep-operation.lock
fi
case "${1:-}" in
  --startup-check) exec python3 -B "$HELPER" --root "$TRANSACTIONS" startup-check --unit "${2:-}" --operation-lock "$OPERATION_LOCK" ;;
  --check) exec python3 -B "$HELPER" --root "$TRANSACTIONS" check ;;
  "") ;;
  *) echo 'Unknown switch recovery argument' >&2; exit 1 ;;
esac

# Ordinary updates may restart services while holding the same lock. With no
# unfinished switch there is no live restoration to serialize.
if python3 -B "$HELPER" --root "$TRANSACTIONS" check 2>/dev/null; then
  exit 0
fi

# Descendants can retain the operation lock after their parent was killed.
python3 -B "$HELPER" --root "$TRANSACTIONS" stop-operations
if [ -e "$OPERATION_LOCK" ]; then
  exec 9<"$OPERATION_LOCK"
else
  exec 9>>"$OPERATION_LOCK"
fi
python3 - <<'PY'
import fcntl, sys
try:
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    sys.exit('Another maintenance operation holds the lock; switch recovery deferred')
PY
source "$RECOVERY_DIR/restore_helpers.sh"
restore_switch_offline "$RECOVERY_DIR" "$TRANSACTIONS"
