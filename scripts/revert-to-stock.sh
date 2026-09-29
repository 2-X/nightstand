#!/bin/bash
# Reverts this pod to plain upstream free-sleep. Upstream ships no tags or
# releases, so main is the only thing to install. Same shape as update.sh:
# backup, stage, atomic swap, health check, auto-rollback on failure.
#
# Runs via free-sleep-revert.service. Re-adopting this fork afterward means
# re-running scripts/migrate/switch-to-this-fork.sh; there's no way back
# from inside the app once upstream free-sleep is running.
set -uo pipefail

UPSTREAM_ZIP_URL="https://github.com/throwaway31265/free-sleep/archive/refs/heads/main.zip"

LIVE=/home/dac/free-sleep
PREV=/home/dac/free-sleep-prev
STAGE=/home/dac/free-sleep-revert-staging
FAILED=/home/dac/free-sleep-revert-failed
ZIP=/home/dac/free-sleep-revert.zip
BACKUPS=/persistent/free-sleep-backups
DATABASE_BACKUPS=/persistent/free-sleep-database-backups
SQLITE_SAFETY="$(dirname "${BASH_SOURCE[0]}")/sqlite-safety.py"
KEEP_BACKUPS=5
NPM=/home/dac/.volta/bin/npm

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

DATA_CHANGED=no
ARCHIVE_WAS_ACTIVE=inactive
restore_switch_data() {
  [ "$DATA_CHANGED" = yes ] || return 0
  for name in settingsDB.json schedulesDB.json; do
    cp -p "$BK/lowdb/$name" "/persistent/free-sleep-data/lowdb/$name" || return 1
  done
  DATA_CHANGED=no
  if [ "$ARCHIVE_WAS_ACTIVE" = active ]; then
    systemctl start free-sleep-archive-raw.timer >/dev/null 2>&1 || true
  fi
}

# A failed settings restore must not prevent recovery of the web UI.
restore_switch_data_or_fail() {
  restore_switch_data || {
    systemctl start free-sleep || true
    if [ "$STREAM_WAS_ACTIVE" = active ]; then
      systemctl restart free-sleep-stream 2>/dev/null || true
    fi
    fail "$*"
  }
}

WAN_OPEN=no
open_wan()  { say "Unblocking internet access (temporary)"; sh "$LIVE/scripts/unblock_internet_access.sh" >/dev/null && WAN_OPEN=yes; }
close_wan() {
  [ "$WAN_OPEN" = yes ] || return 0
  say "Re-blocking internet access"
  sh "$LIVE/scripts/block_internet_access.sh" >/dev/null 2>&1 \
    || sh "$PREV/scripts/block_internet_access.sh" >/dev/null 2>&1 || true
  WAN_OPEN=no
}
cleanup() { close_wan; restore_switch_data || say "WARNING: restore settings from $BK/lowdb before restarting"; rm -rf "$STAGE" "$STAGE.unzip" "$STAGE.health" "$ZIP"; }

fail() { say "FATAL: $*"; exit 1; }

# Keep the descriptor across updater exec handoffs; all three operations share it.
if [ "${NIGHTSTAND_OPERATION_OWNER:-}" != "$$" ]; then
  OPERATION_LOCK="${NIGHTSTAND_OPERATION_LOCK:-/run/lock/free-sleep-operation.lock}"
  if [ -z "${NIGHTSTAND_OPERATION_LOCK:-}" ] && [ ! -d /run/lock ]; then
    OPERATION_LOCK=/tmp/free-sleep-operation.lock
  fi
  exec 9>"$OPERATION_LOCK" || fail "cannot open the update lock"
  if command -v flock >/dev/null 2>&1; then
    flock -n 9 || fail "another update, rollback or switch is already running"
  else
    python3 -c 'import fcntl; fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)' 2>/dev/null \
      || fail "another update, rollback or switch is already running (or lock unavailable)"
  fi
  export NIGHTSTAND_OPERATION_OWNER=$$
fi
trap cleanup EXIT

# --- preflight ---------------------------------------------------------------
[ -d "$LIVE" ] || fail "no live install at $LIVE"
CUR_VERSION=$(python3 -c 'import json;print(json.load(open("'"$LIVE"'/server/src/serverInfo.json"))["version"])' 2>/dev/null) \
  || fail "cannot read current version"

ROOT_FREE=$(df -m / | awk 'NR==2{print $4}')
PERS_FREE=$(df -m /persistent | awk 'NR==2{print $4}')
[ "$ROOT_FREE" -gt 1500 ] || fail "low disk on / (${ROOT_FREE}M free)"
[ "$PERS_FREE" -gt 2000 ] || fail "low disk on /persistent (${PERS_FREE}M free)"

# --- download + stage ---------------------------------------------------------
open_wan
say "Downloading upstream (throwaway31265/free-sleep main)..."
curl -fL --max-time 300 -o "$ZIP" "$UPSTREAM_ZIP_URL" || fail "download failed; live install untouched"
rm -rf "$STAGE" "$STAGE.unzip"
unzip -q "$ZIP" -d "$STAGE.unzip" || fail "unzip failed; live install untouched"
# GitHub names the archive's top dir after the repo and ref (repo-name +
# "-" + branch), so resolve it dynamically rather than hardcoding it.
STAGED_DIR=$(find "$STAGE.unzip" -mindepth 1 -maxdepth 1 -type d | head -n1)
[ -d "$STAGED_DIR" ] || fail "unexpected zip layout; live install untouched"
mv "$STAGED_DIR" "$STAGE" && rm -rf "$STAGE.unzip"
rm -f "$ZIP"
chown -R dac:dac "$STAGE"

[ -f "$STAGE/server/dist/server.js" ] || fail "staged tree is missing server/dist/server.js"
[ -f "$STAGE/server/public/index.html" ] || fail "staged tree is missing server/public/index.html"
STAGED_VERSION=$(python3 -c 'import json;print(json.load(open("'"$STAGE"'/server/src/serverInfo.json"))["version"])') \
  || fail "staged tree has no readable serverInfo.json"

# --- dependencies (old server still running) ---------------------------------
LOCK_SAME=no
cmp -s "$LIVE/server/package-lock.json" "$STAGE/server/package-lock.json" && LOCK_SAME=yes
if [ "$LOCK_SAME" = no ]; then
  say "package-lock.json differs from upstream's: running npm install in staging"
  sudo -u dac bash -c "cd '$STAGE/server' && '$NPM' install --no-audit --no-fund" \
    || fail "npm install failed; live install untouched"
else
  say "package-lock.json matches: reusing existing node_modules"
fi
# Upstream imports this even when the existing services record says installed.
if [ -x /home/dac/venv/bin/python ]; then
  # Upstream leaves this unpinned; keep our revert dependency reproducible.
  VENV_OWNER=$(stat -c '%U' /home/dac/venv) || fail "cannot identify the biometrics venv owner"
  PIP_RUNNER=(env)
  if sudo -u "$VENV_OWNER" /home/dac/venv/bin/python -c 'import os,sysconfig; assert all(os.access(sysconfig.get_path(key), os.W_OK) for key in ("purelib", "platlib"))'; then
    PIP_RUNNER=(sudo -u "$VENV_OWNER")
  else
    say "Venv owner cannot write packages; installing the upstream dependency as root"
  fi
  "${PIP_RUNNER[@]}" /home/dac/venv/bin/python -m pip install sentry-sdk==2.71.0 \
    || fail "could not install the upstream biometrics dependency; live install untouched"
fi
close_wan

# --- backup --------------------------------------------------------------------
TS=$(date +%Y%m%d-%H%M%S)
BK="$BACKUPS/${TS}_v${CUR_VERSION}_prerevert-to-stock"
say "Backing up code + data to $BK"
mkdir -p "$BK"
tar czf "$BK/code.tar.gz" -C /home/dac --exclude free-sleep/server/node_modules free-sleep || fail "backup failed; aborting, nothing changed"
if [ -f /persistent/free-sleep-data/free-sleep.db ]; then
  DB_BACKUP="$DATABASE_BACKUPS/${TS}_v${CUR_VERSION}_switch.db"
  python3 "$SQLITE_SAFETY" backup /persistent/free-sleep-data/free-sleep.db "$DB_BACKUP" \
    || fail "database backup failed; live install untouched"
  say "Database snapshot kept separately at $DB_BACKUP"
fi
cp -r /persistent/free-sleep-data/lowdb "$BK/lowdb" || fail "settings backup failed; live install untouched"
ls -1dt "$BACKUPS"/*/ | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf

# --- atomic swap -----------------------------------------------------------------
say "Installing upstream free-sleep v$STAGED_VERSION (service stops now)"
STREAM_WAS_ACTIVE=$(systemctl is-active free-sleep-stream 2>/dev/null || true)
systemctl stop free-sleep-stream 2>/dev/null || true
systemctl stop free-sleep || fail "could not stop the server before converting settings"
ARCHIVE_WAS_ACTIVE=$(systemctl is-active free-sleep-archive-raw.timer 2>/dev/null || true)
systemctl stop free-sleep-archive-raw.timer free-sleep-archive-raw.service >/dev/null 2>&1 || true
# Refresh the settings copy after stopping writers, before changing its shape.
cp -rp /persistent/free-sleep-data/lowdb/. "$BK/lowdb/" || {
  systemctl start free-sleep
  [ "$STREAM_WAS_ACTIVE" != active ] || systemctl restart free-sleep-stream
  [ "$ARCHIVE_WAS_ACTIVE" != active ] || systemctl start free-sleep-archive-raw.timer
  fail "could not save the stopped settings; no conversion performed"
}
DATA_CHANGED=yes
python3 "$(dirname "${BASH_SOURCE[0]}")/prepare-upstream.py" /persistent/free-sleep-data/lowdb || {
  restore_switch_data_or_fail "conversion failed; restore settings from $BK/lowdb manually"
  systemctl start free-sleep
  [ "$STREAM_WAS_ACTIVE" != active ] || systemctl restart free-sleep-stream
  fail "could not prepare upstream settings; original settings restored"
}
say "RAW archive retained; remove it manually only if no longer needed:"
du -sh /persistent/free-sleep-data/raw-archive 2>/dev/null || true
rm -rf "$PREV"
mv "$LIVE" "$PREV" || {
  restore_switch_data_or_fail "could not restore settings from $BK/lowdb"
  systemctl start free-sleep
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    systemctl restart free-sleep-stream 2>/dev/null || true
  fi
  fail "swap failed moving live aside"
}
mv "$STAGE" "$LIVE" || {
  mv "$PREV" "$LIVE" || fail "swap failed and previous tree could not be restored; manual recovery required"
  restore_switch_data_or_fail "could not restore settings from $BK/lowdb"
  systemctl start free-sleep
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    systemctl restart free-sleep-stream 2>/dev/null || true
  fi
  fail "swap failed; fork restored"
}
MOVED_MODULES=no
if [ "$LOCK_SAME" = yes ]; then
  mv "$PREV/server/node_modules" "$LIVE/server/node_modules"
  chown -R dac:dac "$LIVE/server/node_modules"
  MOVED_MODULES=yes
fi

# No prisma step: migrations are additive, so upstream's schema is already
# a strict subset of ours.
systemctl start free-sleep
if [ "$STREAM_WAS_ACTIVE" = active ]; then
  systemctl restart free-sleep-stream 2>/dev/null || true
fi

# Not gated on a populated per-side temperature: it can lag a few read
# cycles after a cold reconnect (see pod-installer.sh's health check).
say "Health check (up to 90s)"
HEALTHY=no
HBODY="$STAGE.health"
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
    assert d['freeSleep']['version'] == '$STAGED_VERSION'
    print('yes')
except Exception:
    print('no')" 2>/dev/null)
  [ "$OK" = yes ] && { HEALTHY=yes; break; }
done
rm -f "$HBODY"
[ "$HEALTHY" = yes ] && systemctl is-active free-sleep >/dev/null || HEALTHY=no

if [ "$HEALTHY" = yes ]; then
  DATA_CHANGED=no
  systemctl disable --now free-sleep-archive-raw.timer >/dev/null 2>&1 || true
  say "SUCCESS: pod is serving upstream free-sleep v$STAGED_VERSION. This fork kept at $PREV (no in-app way back; re-adopt via scripts/migrate/switch-to-this-fork.sh). Backup at $BK"
  # These units point at scripts that no longer exist in $LIVE.
  say "Removing fork-only systemd units (instant rollback, this revert service)"
  rm -f /etc/systemd/system/free-sleep-rollback.service /etc/systemd/system/free-sleep-revert.service \
    /etc/systemd/system/free-sleep-archive-raw.service /etc/systemd/system/free-sleep-archive-raw.timer
  # Upstream free-sleep never installs these. They take effect at the next service start.
  rm -f /etc/systemd/system/free-sleep.service.d/10-nightstand-limits.conf \
    /etc/systemd/system/free-sleep-stream.service.d/10-nightstand-limits.conf
  systemctl daemon-reload >/dev/null 2>&1 || true
  exit 0
fi

# --- automatic rollback to this fork ---------------------------------------------
say "Health check FAILED: rolling back to this fork v$CUR_VERSION"
say "Last 60 server log lines from the failed upstream free-sleep build (for diagnosis):"
tail -n 60 /persistent/free-sleep-data/logs/free-sleep.log 2>/dev/null || say "  (no server log available)"
systemctl stop free-sleep || true
systemctl stop free-sleep-stream 2>/dev/null || true
rm -rf "$FAILED"
mv "$LIVE" "$FAILED" || {
  restore_switch_data_or_fail "could not restore settings from $BK/lowdb"
  systemctl start free-sleep
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    systemctl restart free-sleep-stream 2>/dev/null || true
  fi
  fail "could not move failed tree aside; attempted to restart the tree at $LIVE; manual recovery required"
}
mv "$PREV" "$LIVE" || {
  mv "$FAILED" "$LIVE" || fail "could not restore either tree; manual recovery required"
  restore_switch_data_or_fail "could not restore settings from $BK/lowdb"
  systemctl start free-sleep
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    systemctl restart free-sleep-stream 2>/dev/null || true
  fi
  fail "could not restore previous tree; attempted to restart the tree at $LIVE; manual recovery required"
}
if [ "$MOVED_MODULES" = yes ]; then
  mv "$FAILED/server/node_modules" "$LIVE/server/node_modules"
fi
restore_switch_data_or_fail "could not restore settings from $BK/lowdb"
sh "$LIVE/scripts/block_internet_access.sh" || say "WARNING: restored firewall could not be applied"
systemctl start free-sleep
if [ "$STREAM_WAS_ACTIVE" = active ]; then
  systemctl restart free-sleep-stream 2>/dev/null || true
fi
sleep 8
if curl -sf --max-time 5 "http://127.0.0.1:3000/api/deviceStatus" >/dev/null; then
  fail "revert to upstream free-sleep failed but rollback OK (pod back on this fork v$CUR_VERSION). Failed tree kept at $FAILED; see journalctl -u free-sleep"
else
  fail "revert to upstream free-sleep failed AND rollback health check failed. Backup tarball: $BK. Check journalctl -u free-sleep. Schedules and alarms remain unavailable until the server is restored."
fi
