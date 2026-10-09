#!/bin/bash
# Keeps database snapshots from filling /persistent, which also holds the
# firmware's data and the Wi-Fi settings. The newest 3 and any younger than
# 7 days stay; then, while free space is under the floor, the oldest go
# first. The newest and the one just written are never removed, and only files named like the
# snapshots Nightstand writes are ever considered.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -uo pipefail

DIR="${1:-}"
# A snapshot just written is never removed, whatever its timestamp says.
KEEP_NAME="${2:-}"
KEEP_NAME="${KEEP_NAME##*/}"
[ -n "$DIR" ] || DIR=/persistent/free-sleep-database-backups
KEEP=3
KEEP_SECONDS=$((7 * 86400))
FLOOR_MB="${NIGHTSTAND_SNAPSHOT_FLOOR_MB:-512}"
case "$FLOOR_MB" in '' | *[!0-9]*) FLOOR_MB=512 ;; esac

# Update and switch: 20260101-120000_v3.0.0_update.db. Install and reset:
# 20260101T120000Z-4321-install.db.
NAME_RE='^([0-9]{8}-[0-9]{6}_v[A-Za-z0-9.+-]+_(update|switch)|[0-9]{8}T[0-9]{6}Z-[0-9]+-(install|reset))\.db$'

[ -d "$DIR" ] || exit 0
DIR="${DIR%/}"
[ -n "$DIR" ] || exit 0
DIR=$(cd -- "$DIR" && pwd -P) || exit 1

# A retained tree can still need its transaction's database backup after commit.
# An unreadable journal blocks pruning so recovery evidence is not discarded.
TRANSACTIONS="${NIGHTSTAND_TRANSACTION_ROOT:-/persistent/free-sleep-maintenance/nightstand-transactions}"
PROTECTED=""
if [ -e "$TRANSACTIONS" ] || [ -L "$TRANSACTIONS" ]; then
  PROTECTED=$(python3 -B "$(dirname "${BASH_SOURCE[0]}")/switch_transaction.py" --root "$TRANSACTIONS" protected-backups) || {
    echo "Could not read switch transactions; database snapshots were not pruned" >&2
    exit 1
  }
fi
protected() {
  local backup
  while IFS= read -r backup; do
    [ -n "$backup" ] || continue
    [ "$backup" != "$DIR/$1" ] || return 0
  done <<< "$PROTECTED"
  return 1
}

free_mb() { { df -kP "$1" 2>/dev/null || true; } | awk 'NR == 2 && $4 ~ /^[0-9]+$/ { print int($4 / 1024) }'; }
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }
remove() {
  protected "$1" && return 1
  if rm -f -- "$DIR/$1" 2>/dev/null && [ ! -e "$DIR/$1" ]; then
    echo "Removed old database snapshot $1"
  else
    echo "Could not remove old database snapshot $1"
    return 1
  fi
}

LIST=""
for path in "$DIR"/*; do
  name="${path##*/}"
  [[ "$name" =~ $NAME_RE ]] || continue
  [ -f "$path" ] && [ ! -L "$path" ] || continue
  stamp=$(mtime "$path")
  case "$stamp" in '' | *[!0-9]*) continue ;; esac
  LIST="$LIST$stamp $name"$'\n'
done
[ -n "$LIST" ] || exit 0

# Newest first; equal times fall back to the name so the order is stable.
NOW=$(date +%s)
KEPT=()
index=0
while read -r stamp name; do
  [ -n "$name" ] || continue
  if [ "$index" -ge "$KEEP" ] && [ "$name" != "$KEEP_NAME" ] && [ $((NOW - stamp)) -ge "$KEEP_SECONDS" ]; then
    remove "$name" || KEPT+=("$name")
  else
    KEPT+=("$name")
  fi
  index=$((index + 1))
done < <(printf '%s' "$LIST" | sort -k1,1nr -k2,2r)

last=$(( ${#KEPT[@]} - 1 ))
while [ "$last" -ge 1 ]; do
  free=$(free_mb "$DIR")
  { [ -n "$free" ] && [ "$free" -lt "$FLOOR_MB" ]; } || break
  if [ "${KEPT[$last]}" != "$KEEP_NAME" ]; then remove "${KEPT[$last]}" || true; fi
  last=$((last - 1))
done
exit 0
