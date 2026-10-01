#!/bin/bash
# Instant rollback: swaps the live install back to the previous tree that
# scripts/update.sh leaves at $PREV after every update. Seconds, fully
# offline (applies the restored firewall), distinct from installing an older version
# via the version picker, which is a
# full download and takes minutes. PREV only ever holds one step of history,
# so this can only go back one release.
#
# Runs on the pod as root, via free-sleep-rollback.service (triggered from
# the app's Settings page).
set -uo pipefail

LIVE=/home/dac/free-sleep
PREV=/home/dac/free-sleep-prev
TMP=/home/dac/free-sleep-rollback-tmp

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { say "FATAL: $*"; exit 1; }

# Keep the descriptor across updater exec handoffs; all three operations share it.
if [ "${NIGHTSTAND_OPERATION_OWNER:-}" != "$$" ]; then
  OPERATION_LOCK="${NIGHTSTAND_OPERATION_LOCK:-/run/lock/free-sleep-operation.lock}"
  if [ -z "${NIGHTSTAND_OPERATION_LOCK:-}" ] && [ ! -d /run/lock ]; then
    OPERATION_LOCK=/tmp/free-sleep-operation.lock
  fi
  exec 9>>"$OPERATION_LOCK" || fail "cannot open the update lock"
  if command -v flock >/dev/null 2>&1; then
    flock -n 9 || fail "another update, rollback or switch is already running"
  else
    python3 -c 'import fcntl; fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)' 2>/dev/null \
      || fail "another update, rollback or switch is already running (or lock unavailable)"
  fi
  export NIGHTSTAND_OPERATION_OWNER=$$
fi

# node_modules can live in only one of the two trees: when the update that
# produced this LIVE/PREV pair reused node_modules (identical lockfiles), it
# moved the single copy into whichever tree became LIVE, leaving PREV without
# one. A LIVE/PREV swap is a straight transposition, so that copy ends up on
# the wrong side afterward. This re-checks the CURRENT state after any swap
# (rather than trusting a pre-swap guess) and moves it back only if actually
# needed and actually safe (lockfiles still match).
fix_shared_node_modules() {
  local source="${1:-$PREV}"
  if [ -d "$source/server/node_modules" ] && [ ! -d "$LIVE/server/node_modules" ] \
    && cmp -s "$LIVE/server/package-lock.json" "$source/server/package-lock.json"; then
    mv "$source/server/node_modules" "$LIVE/server/node_modules"
    chown -R dac:dac "$LIVE/server/node_modules"
  fi
}

restart_services() {
  if [ "${ARCHIVE_WAS_ACTIVE:-inactive}" = active ] && \
    [ -f "$LIVE/scripts/archive-raw.sh" ]; then
    systemctl start free-sleep-archive-raw.timer >/dev/null 2>&1 || true
  fi
  if [ -f "$LIVE/scripts/block_internet_access.sh" ]; then
    sh "$LIVE/scripts/block_internet_access.sh" || say "WARNING: restored firewall could not be applied"
  fi
  systemctl start free-sleep
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    systemctl restart free-sleep-stream 2>/dev/null || true
  fi
}

# --- preflight ---------------------------------------------------------------
[ -d "$LIVE" ] || fail "no live install at $LIVE"
[ -d "$PREV" ] || fail "no previous install at $PREV; nothing to roll back to"
TARGET_VERSION=$(python3 -c 'import json;print(json.load(open("'"$PREV"'/server/src/serverInfo.json"))["version"])' 2>/dev/null) \
  || fail "$PREV has no readable serverInfo.json; refusing to swap to an unknown tree"
CUR_VERSION=$(python3 -c 'import json;print(json.load(open("'"$LIVE"'/server/src/serverInfo.json"))["version"])' 2>/dev/null) \
  || fail "cannot read the running version"
say "Rolling back v$CUR_VERSION -> v$TARGET_VERSION"

# Other forks cannot run Nightstand's archive timer or its memory drop-ins.
TARGET_IS_NIGHTSTAND=no
[ -f "$PREV/scripts/archive-raw.sh" ] && TARGET_IS_NIGHTSTAND=yes
ARCHIVE_WAS_ACTIVE=$(systemctl is-active free-sleep-archive-raw.timer 2>/dev/null || true)
if [ "$TARGET_IS_NIGHTSTAND" = yes ]; then
  python3 "$LIVE/scripts/prepare-downgrade.py" "$PREV/scripts/archive-raw.sh" /persistent/free-sleep-data/raw-archive.conf \
    || fail "could not preserve archive retention; rollback cancelled before the swap"
else
  systemctl stop free-sleep-archive-raw.timer free-sleep-archive-raw.service >/dev/null 2>&1 || true
fi

# --- swap ----------------------------------------------------------------------
# The running server hands back what the next version may not continue. A
# target that has the same route continues it itself.
if ! grep -qs prepare-to-stop "$PREV/server/dist/routes/update/update.js"; then
  curl -fsS --max-time 60 -X POST -H 'content-type: application/json' -d '{"reason":"rollback"}' \
    http://127.0.0.1:3000/api/update/prepare-to-stop >/dev/null \
    || say "WARNING: the server could not prepare to stop; continuing"
fi
STREAM_WAS_ACTIVE=$(systemctl is-active free-sleep-stream 2>/dev/null || true)
systemctl stop free-sleep-stream 2>/dev/null || true
systemctl stop free-sleep
rm -rf "$TMP"
mv "$LIVE" "$TMP" || {
  restart_services
  fail "swap failed moving live aside"
}
mv "$PREV" "$LIVE" || {
  mv "$TMP" "$LIVE" || fail "swap failed and running tree could not be restored; manual recovery required"
  restart_services
  fail "swap failed; running version restored"
}
mv "$TMP" "$PREV" || {
  # Keep the original tree safe if the rollback slot cannot be finalized.
  mv "$LIVE" "$PREV" || {
    fix_shared_node_modules "$TMP"
    restart_services
    fail "could not preserve rollback slot; attempted to restart $LIVE; original tree kept at $TMP; manual recovery required"
  }
  mv "$TMP" "$LIVE" || {
    mv "$PREV" "$LIVE" || fail "could not restore either tree; trees kept at $TMP and $PREV; manual recovery required"
    fix_shared_node_modules "$TMP"
    restart_services
    fail "could not restore original tree at $TMP; attempted to restart $LIVE; manual recovery required"
  }
  restart_services
  fail "could not preserve rollback slot; original running version restored"
}
fix_shared_node_modules

restart_services

# --- health check (same shape as update.sh) -----------------------------------
say "Health check (up to 90s)"
HEALTHY=no
HBODY=/tmp/free-sleep-rollback-health
for _ in $(seq 1 30); do
  sleep 3
  CODE=$(curl -s -o "$HBODY" -w '%{http_code}' --max-time 5 "http://127.0.0.1:3000/api/deviceStatus" 2>/dev/null || echo 000)
  say "  health attempt: HTTP $CODE"
  [ "$CODE" = 200 ] || continue
  R=$(cat "$HBODY" 2>/dev/null) || continue
  OK=$(printf '%s' "$R" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    assert d['freeSleep']['version'] == '$TARGET_VERSION'
    assert isinstance(d['left']['currentTemperatureF'], (int, float))
    print('yes')
except Exception:
    print('no')" 2>/dev/null)
  [ "$OK" = yes ] && { HEALTHY=yes; break; }
done
rm -f "$HBODY"
[ "$HEALTHY" = yes ] && systemctl is-active free-sleep >/dev/null || HEALTHY=no

if [ "$HEALTHY" = yes ]; then
  if [ "$TARGET_IS_NIGHTSTAND" != yes ]; then
    systemctl disable --now free-sleep-archive-raw.timer >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/free-sleep-archive-raw.service /etc/systemd/system/free-sleep-archive-raw.timer \
      /etc/systemd/system/free-sleep.service.d/10-nightstand-limits.conf \
      /etc/systemd/system/free-sleep-stream.service.d/10-nightstand-limits.conf
    systemctl daemon-reload
  fi
  say "SUCCESS: pod is serving v$TARGET_VERSION (rolled back from v$CUR_VERSION)"
  exit 0
fi

# --- swap back on failure --------------------------------------------------------
# A rollback that fails leaves the version that was running BEFORE this
# script started still running. Never leave the pod on neither tree.
say "Health check FAILED: swapping back to v$CUR_VERSION"
systemctl stop free-sleep || true
systemctl stop free-sleep-stream 2>/dev/null || true
rm -rf "$TMP"
mv "$LIVE" "$TMP" || {
  restart_services
  fail "could not move failed tree aside; attempted to restart $LIVE; manual recovery required"
}
mv "$PREV" "$LIVE" || {
  mv "$TMP" "$LIVE" || fail "could not restore either tree; trees kept at $TMP and $PREV; manual recovery required"
  restart_services
  fail "could not restore previous tree; attempted to restart $LIVE; manual recovery required"
}
mv "$TMP" "$PREV" || {
  say "WARNING: could not preserve rollback slot; tree remains at $TMP"
  fix_shared_node_modules "$TMP"
}
fix_shared_node_modules
restart_services
sleep 8
if curl -sf --max-time 5 "http://127.0.0.1:3000/api/deviceStatus" >/dev/null; then
  fail "rollback to v$TARGET_VERSION failed health check; restored v$CUR_VERSION (still running). Check journalctl -u free-sleep-rollback"
else
  fail "rollback failed AND the restore-back health check failed too. Check journalctl -u free-sleep. The bed hardware itself keeps running regardless."
fi
