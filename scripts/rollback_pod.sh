#!/bin/bash
# Instant rollback: swaps the live install back to the previous tree that
# scripts/update.sh leaves at $PREV after every update. Seconds, fully
# offline (never touches WAN), distinct from installing an older version
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

# node_modules can live in only one of the two trees: when the update that
# produced this LIVE/PREV pair reused node_modules (identical lockfiles), it
# moved the single copy into whichever tree became LIVE, leaving PREV without
# one. A LIVE/PREV swap is a straight transposition, so that copy ends up on
# the wrong side afterward. This re-checks the CURRENT state after any swap
# (rather than trusting a pre-swap guess) and moves it back only if actually
# needed and actually safe (lockfiles still match).
fix_shared_node_modules() {
  if [ -d "$PREV/server/node_modules" ] && [ ! -d "$LIVE/server/node_modules" ] \
    && cmp -s "$LIVE/server/package-lock.json" "$PREV/server/package-lock.json"; then
    mv "$PREV/server/node_modules" "$LIVE/server/node_modules"
    chown -R dac:dac "$LIVE/server/node_modules"
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

# --- swap ----------------------------------------------------------------------
systemctl stop free-sleep
rm -rf "$TMP"
mv "$LIVE" "$TMP" || fail "swap failed moving live aside"
mv "$PREV" "$LIVE" || { mv "$TMP" "$LIVE"; systemctl start free-sleep; fail "swap failed; running version restored"; }
mv "$TMP" "$PREV"
fix_shared_node_modules

systemctl start free-sleep

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
  say "SUCCESS: pod is serving v$TARGET_VERSION (rolled back from v$CUR_VERSION)"
  exit 0
fi

# --- swap back on failure --------------------------------------------------------
# A rollback that fails leaves the version that was running BEFORE this
# script started still running. Never leave the pod on neither tree.
say "Health check FAILED: swapping back to v$CUR_VERSION"
systemctl stop free-sleep || true
rm -rf "$TMP"
mv "$LIVE" "$TMP"
mv "$PREV" "$LIVE"
mv "$TMP" "$PREV"
fix_shared_node_modules
systemctl start free-sleep
sleep 8
if curl -sf --max-time 5 "http://127.0.0.1:3000/api/deviceStatus" >/dev/null; then
  fail "rollback to v$TARGET_VERSION failed health check; restored v$CUR_VERSION (still running). Check journalctl -u free-sleep-rollback"
else
  fail "rollback failed AND the restore-back health check failed too. Check journalctl -u free-sleep. The bed hardware itself keeps running regardless."
fi
