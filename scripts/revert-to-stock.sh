#!/bin/bash
# Reverts this pod to plain upstream free-sleep. Upstream ships no tags or
# releases, so main is the only thing to install. Same shape as update.sh:
# backup, stage, atomic swap, health check, auto-rollback on failure.
#
# Runs via free-sleep-revert.service. Re-adopting this fork afterward means
# re-running scripts/migrate/switch-to-this-fork.sh; there's no way back
# from inside the app once stock is running.
set -uo pipefail

UPSTREAM_ZIP_URL="https://github.com/throwaway31265/free-sleep/archive/refs/heads/main.zip"

LIVE=/home/dac/free-sleep
PREV=/home/dac/free-sleep-prev
STAGE=/home/dac/free-sleep-revert-staging
FAILED=/home/dac/free-sleep-revert-failed
ZIP=/home/dac/free-sleep-revert.zip
BACKUPS=/persistent/free-sleep-backups
KEEP_BACKUPS=5
NPM=/home/dac/.volta/bin/npm

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

WAN_OPEN=no
open_wan()  { say "Unblocking internet access (temporary)"; sh "$LIVE/scripts/unblock_internet_access.sh" >/dev/null && WAN_OPEN=yes; }
close_wan() {
  [ "$WAN_OPEN" = yes ] || return 0
  say "Re-blocking internet access"
  sh "$LIVE/scripts/block_internet_access.sh" >/dev/null 2>&1 \
    || sh "$PREV/scripts/block_internet_access.sh" >/dev/null 2>&1 || true
  WAN_OPEN=no
}
cleanup() { close_wan; rm -rf "$STAGE" "$STAGE.unzip" "$STAGE.health" "$ZIP"; }
trap cleanup EXIT

fail() { say "FATAL: $*"; exit 1; }

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
close_wan

# --- backup --------------------------------------------------------------------
TS=$(date +%Y%m%d-%H%M%S)
BK="$BACKUPS/${TS}_v${CUR_VERSION}_prerevert-to-stock"
say "Backing up code + data to $BK"
mkdir -p "$BK"
tar czf "$BK/code.tar.gz" -C /home/dac --exclude free-sleep/server/node_modules free-sleep || fail "backup failed; aborting, nothing changed"
cp /persistent/free-sleep-data/free-sleep.db "$BK/" 2>/dev/null || true
cp -r /persistent/free-sleep-data/lowdb "$BK/lowdb" 2>/dev/null || true
ls -1dt "$BACKUPS"/*/ | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf

# --- atomic swap -----------------------------------------------------------------
say "Installing stock v$STAGED_VERSION (service stops now)"
systemctl stop free-sleep
rm -rf "$PREV"
mv "$LIVE" "$PREV" || fail "swap failed moving live aside"
mv "$STAGE" "$LIVE" || { mv "$PREV" "$LIVE"; systemctl start free-sleep; fail "swap failed; fork restored"; }
MOVED_MODULES=no
if [ "$LOCK_SAME" = yes ]; then
  mv "$PREV/server/node_modules" "$LIVE/server/node_modules"
  chown -R dac:dac "$LIVE/server/node_modules"
  MOVED_MODULES=yes
fi

# No prisma step: migrations are additive, so upstream's schema is already
# a strict subset of ours.
systemctl start free-sleep

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
  say "SUCCESS: pod is serving stock v$STAGED_VERSION. This fork kept at $PREV (no in-app way back; re-adopt via scripts/migrate/switch-to-this-fork.sh). Backup at $BK"
  # These units point at scripts that no longer exist in $LIVE.
  say "Removing fork-only systemd units (instant rollback, this revert service)"
  rm -f /etc/systemd/system/free-sleep-rollback.service /etc/systemd/system/free-sleep-revert.service
  systemctl daemon-reload >/dev/null 2>&1 || true
  exit 0
fi

# --- automatic rollback to this fork ---------------------------------------------
say "Health check FAILED: rolling back to this fork v$CUR_VERSION"
say "Last 60 server log lines from the failed stock build (for diagnosis):"
tail -n 60 /persistent/free-sleep-data/logs/free-sleep.log 2>/dev/null || say "  (no server log available)"
systemctl stop free-sleep || true
rm -rf "$FAILED"
mv "$LIVE" "$FAILED"
mv "$PREV" "$LIVE"
if [ "$MOVED_MODULES" = yes ]; then
  mv "$FAILED/server/node_modules" "$LIVE/server/node_modules"
fi
systemctl start free-sleep
sleep 8
if curl -sf --max-time 5 "http://127.0.0.1:3000/api/deviceStatus" >/dev/null; then
  fail "revert to stock failed but rollback OK (pod back on this fork v$CUR_VERSION). Failed tree kept at $FAILED; see journalctl -u free-sleep"
else
  fail "revert to stock failed AND rollback health check failed. Backup tarball: $BK. Check journalctl -u free-sleep. The bed hardware itself keeps running regardless."
fi
