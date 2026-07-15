#!/bin/bash
# Self-updater for this fork. Downloads the latest main branch of
# LTimothy/nightstand from GitHub and installs it: backup, stage, atomic
# swap, health check, automatic rollback on failure.
#
# Runs on the pod as root, normally via free-sleep-update.service (triggered
# from the app's Settings page). Internet access is opened only long enough
# to download, then re-blocked no matter how the script exits.
#
# Env:
#   FS_UPDATE_FORCE=1   install even if the published version isn't newer
#   NIGHTSTAND_REPO     GitHub repo to pull from (default: LTimothy/nightstand)
#   NIGHTSTAND_BRANCH   branch to pull from (default: main)
#
# Target-version protocol: if the server wrote
# /persistent/free-sleep-data/update-target.json before starting this
# service, that file requests a specific version (and whether a downgrade is
# allowed) instead of "latest branch". See the "consume the target-version
# request file" block below.
set -uo pipefail

NIGHTSTAND_REPO="${NIGHTSTAND_REPO:-LTimothy/nightstand}"
NIGHTSTAND_BRANCH="${NIGHTSTAND_BRANCH:-main}"
INFO_URL="https://raw.githubusercontent.com/${NIGHTSTAND_REPO}/${NIGHTSTAND_BRANCH}/server/src/serverInfo.json"
ZIP_URL="https://github.com/${NIGHTSTAND_REPO}/archive/refs/heads/${NIGHTSTAND_BRANCH}.zip"
RELEASES_URL="https://raw.githubusercontent.com/${NIGHTSTAND_REPO}/${NIGHTSTAND_BRANCH}/releases.json"
TAG_ZIP_URL_PREFIX="https://github.com/${NIGHTSTAND_REPO}/archive/refs/tags/v"

# update-target.json protocol: written by POST /api/update before starting
# this service. Consumed once (deleted immediately after reading) so a stale
# file can never redirect a future plain update. FLOOR_VERSION is the first
# release that ships this protocol; versions below it predate the target
# protocol, the rollback service, and possibly current lockfile/node_modules
# compatibility, so the picker can't reach them. This tree has no version of
# its own yet, so this stays a marker for the first real release rather than
# a currently reachable floor.
TARGET_FILE=/persistent/free-sleep-data/update-target.json
FLOOR_VERSION="3.2.0"

LIVE=/home/dac/free-sleep
PREV=/home/dac/free-sleep-prev
STAGE=/home/dac/free-sleep-staging
FAILED=/home/dac/free-sleep-failed
ZIP=/home/dac/free-sleep-update.zip
BACKUPS=/persistent/free-sleep-backups
KEEP_BACKUPS=5
NPM=/home/dac/.volta/bin/npm
NPX=/home/dac/.volta/bin/npx

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

# --- consume the target-version request file, if any -------------------------
TARGET_VERSION=""
ALLOW_DOWNGRADE=no
if [ -f "$TARGET_FILE" ]; then
  TARGET_JSON=$(cat "$TARGET_FILE")
  rm -f "$TARGET_FILE"
  TARGET_VERSION=$(printf '%s' "$TARGET_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("version",""))' 2>/dev/null) || TARGET_VERSION=""
  ALLOW_DOWNGRADE_RAW=$(printf '%s' "$TARGET_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("allowDowngrade",False))' 2>/dev/null) || ALLOW_DOWNGRADE_RAW=False
  [ "$ALLOW_DOWNGRADE_RAW" = True ] && ALLOW_DOWNGRADE=yes
  [ -n "$TARGET_VERSION" ] && say "Target-version request: v$TARGET_VERSION (allowDowngrade=$ALLOW_DOWNGRADE)"
fi

if [ -n "$TARGET_VERSION" ]; then
  FLOOR_OK=$(python3 -c '
import sys
def parts(v): return [int(x) for x in v.split(".")]
print("yes" if parts(sys.argv[1]) >= parts(sys.argv[2]) else "no")' "$TARGET_VERSION" "$FLOOR_VERSION")
  [ "$FLOOR_OK" = yes ] || fail "target v$TARGET_VERSION is below the floor (v$FLOOR_VERSION) the version picker supports"
fi

# --- resolve what to install --------------------------------------------------
open_wan
say "Current version: v$CUR_VERSION."
IS_DOWNGRADE=no
if [ -n "$TARGET_VERSION" ]; then
  say "Resolving requested v$TARGET_VERSION against releases.json..."
  RELEASES_JSON=$(curl -fsSL --max-time 20 "$RELEASES_URL") \
    || fail "could not fetch releases.json (check internet access and DNS)"
  MANIFEST_CHECK=$(printf '%s' "$RELEASES_JSON" | python3 -c "
import json, sys
target = '$TARGET_VERSION'
data = json.load(sys.stdin)
versions = [r['version'] for r in data['releases']]
if target not in versions:
    print('missing')
elif data['releases'][0]['version'] == target:
    print('head')
else:
    print('tagged')
" 2>/dev/null) || fail "could not parse releases.json"
  [ "$MANIFEST_CHECK" = missing ] && fail "v$TARGET_VERSION is not a known release (checked releases.json)"

  IS_DOWNGRADE=$(python3 -c '
import sys
def parts(v): return [int(x) for x in v.split(".")]
print("yes" if parts(sys.argv[1]) < parts(sys.argv[2]) else "no")' "$TARGET_VERSION" "$CUR_VERSION")
  if [ "$IS_DOWNGRADE" = yes ] && [ "$ALLOW_DOWNGRADE" != yes ]; then
    fail "v$TARGET_VERSION is older than the running v$CUR_VERSION; refusing without allowDowngrade"
  fi

  if [ "$MANIFEST_CHECK" = head ]; then
    say "Requested version is the manifest head; using the branch zip"
    RESOLVED_ZIP_URL="$ZIP_URL"
  else
    say "Requested version is an older tagged release; using the v$TARGET_VERSION tag archive"
    RESOLVED_ZIP_URL="${TAG_ZIP_URL_PREFIX}${TARGET_VERSION}.zip"
  fi
  EXPECTED_VERSION="$TARGET_VERSION"
else
  say "Checking GitHub for the latest build..."
  REMOTE_VERSION=$(curl -fsSL --max-time 20 "$INFO_URL" | python3 -c 'import json,sys;print(json.load(sys.stdin)["version"])') \
    || fail "could not fetch the published version (check internet access and DNS)"

  NEWER=$(python3 -c '
import sys
cur = [int(x) for x in sys.argv[1].split(".")]
pub = [int(x) for x in sys.argv[2].split(".")]
print("yes" if pub > cur else "no")' "$CUR_VERSION" "$REMOTE_VERSION")

  if [ "$NEWER" = no ] && [ "${FS_UPDATE_FORCE:-0}" != 1 ]; then
    say "Already up to date (published: v$REMOTE_VERSION). Nothing to do."
    exit 0
  fi
  RESOLVED_ZIP_URL="$ZIP_URL"
  EXPECTED_VERSION="$REMOTE_VERSION"
fi

# --- download + stage --------------------------------------------------------
say "Downloading v$EXPECTED_VERSION..."
curl -fL --max-time 300 -o "$ZIP" "$RESOLVED_ZIP_URL" || fail "download failed"
rm -rf "$STAGE" "$STAGE.unzip"
unzip -q "$ZIP" -d "$STAGE.unzip" || fail "unzip failed"
# GitHub names the archive's top dir after the repo and ref (repo-name + "-" +
# branch or tag), so resolve it dynamically rather than hardcoding it.
STAGED_DIR=$(find "$STAGE.unzip" -mindepth 1 -maxdepth 1 -type d | head -n1)
[ -d "$STAGED_DIR" ] || fail "unexpected zip layout"
mv "$STAGED_DIR" "$STAGE" && rm -rf "$STAGE.unzip"
rm -f "$ZIP"
chown -R dac:dac "$STAGE"

# the pod runs prebuilt code; refuse anything missing its build output
[ -f "$STAGE/server/dist/server.js" ] || fail "staged tree is missing server/dist/server.js"
[ -f "$STAGE/server/public/index.html" ] || fail "staged tree is missing server/public/index.html"
STAGED_VERSION=$(python3 -c 'import json;print(json.load(open("'"$STAGE"'/server/src/serverInfo.json"))["version"])') \
  || fail "staged tree has no readable serverInfo.json"
if [ -n "$TARGET_VERSION" ] && [ "$STAGED_VERSION" != "$TARGET_VERSION" ]; then
  fail "staged tree reports v$STAGED_VERSION but v$TARGET_VERSION was requested; refusing a mislabeled release"
fi

# --- dependencies (old server still running) ---------------------------------
LOCK_SAME=no
cmp -s "$LIVE/server/package-lock.json" "$STAGE/server/package-lock.json" && LOCK_SAME=yes
if [ "$LOCK_SAME" = no ]; then
  say "package-lock.json changed: running npm install in staging"
  sudo -u dac bash -c "cd '$STAGE/server' && '$NPM' install --no-audit --no-fund" \
    || fail "npm install failed; live install untouched"
else
  say "package-lock.json unchanged: reusing existing node_modules"
fi
close_wan

# --- backup ------------------------------------------------------------------
TS=$(date +%Y%m%d-%H%M%S)
BK="$BACKUPS/${TS}_v${CUR_VERSION}"
say "Backing up code + data to $BK"
mkdir -p "$BK"
tar czf "$BK/code.tar.gz" -C /home/dac --exclude free-sleep/server/node_modules free-sleep || fail "backup failed; aborting, nothing changed"
cp /persistent/free-sleep-data/free-sleep.db "$BK/" 2>/dev/null || true
cp -r /persistent/free-sleep-data/lowdb "$BK/lowdb" 2>/dev/null || true
ls -1dt "$BACKUPS"/*/ | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf

# --- atomic swap ---------------------------------------------------------------
say "Installing v$STAGED_VERSION (service stops now)"
systemctl stop free-sleep
rm -rf "$PREV"
mv "$LIVE" "$PREV" || fail "swap failed moving live aside"
mv "$STAGE" "$LIVE" || { mv "$PREV" "$LIVE"; systemctl start free-sleep; fail "swap failed; previous version restored"; }
MOVED_MODULES=no
if [ "$LOCK_SAME" = yes ]; then
  mv "$PREV/server/node_modules" "$LIVE/server/node_modules"
  chown -R dac:dac "$LIVE/server/node_modules"
  MOVED_MODULES=yes
fi

if [ "$IS_DOWNGRADE" = yes ]; then
  say "Downgrade: skipping prisma migrate (schema stays newer; migrations are additive by standing rule)"
elif ! cmp -s "$PREV/server/prisma/schema.prisma" "$LIVE/server/prisma/schema.prisma"; then
  say "Prisma schema changed: migrate deploy + generate"
  sudo -u dac bash -c "cd '$LIVE/server' && '$NPX' dotenv -e .env.pod -- npx prisma migrate deploy && '$NPX' dotenv -e .env.pod -- npx prisma generate" \
    || say "WARNING: prisma step failed; health check will decide"
fi

systemctl start free-sleep
systemctl try-restart free-sleep-stream 2>/dev/null || true

# Self-heal exec bits on the updater chain: free-sleep-update.service execs
# update_service.sh directly on older installs, and a missing exec bit fails
# the unit with 203/EXEC before it can log anything.
chmod +x "$LIVE"/scripts/update.sh "$LIVE"/scripts/update_service.sh 2>/dev/null || true

# --- instant-rollback service --------------------------------------------------
# Installs that predate the instant-rollback feature never got
# free-sleep-rollback.service or its sudoers rule, so the in-app "Roll back"
# button would 404 against systemd. Idempotent — safe to re-run on every update.
say "Ensuring instant-rollback service is installed"
if chmod +x "$LIVE/scripts/rollback_pod.sh" \
  && cp "$LIVE/scripts/systemd/free-sleep-rollback.service" /etc/systemd/system/ \
  && systemctl daemon-reload; then
  :
else
  say "WARNING: failed to install the instant-rollback service; the Roll back button will not work until the next successful update"
fi
ROLLBACK_SUDOERS_RULE="dac ALL=(root) NOPASSWD: /bin/systemctl start free-sleep-rollback.service --no-block"
SUDOERS_FILE=/etc/sudoers.d/dac
if [ -f "$SUDOERS_FILE" ] && grep -Fxq "$ROLLBACK_SUDOERS_RULE" "$SUDOERS_FILE" 2>/dev/null; then
  :
else
  echo "$ROLLBACK_SUDOERS_RULE" >> "$SUDOERS_FILE" && chmod 440 "$SUDOERS_FILE" \
    || say "WARNING: failed to add rollback sudoers rule; the Roll back button will not work until the next successful update"
fi

# --- revert-to-stock service ----------------------------------------------------
say "Ensuring revert-to-stock service is installed"
if chmod +x "$LIVE/scripts/revert-to-stock.sh" \
  && cp "$LIVE/scripts/systemd/free-sleep-revert.service" /etc/systemd/system/ \
  && systemctl daemon-reload; then
  :
else
  say "WARNING: failed to install the revert-to-stock service; the Revert to stock control will not work until the next successful update"
fi
REVERT_SUDOERS_RULE="dac ALL=(root) NOPASSWD: /bin/systemctl start free-sleep-revert.service --no-block"
if [ -f "$SUDOERS_FILE" ] && grep -Fxq "$REVERT_SUDOERS_RULE" "$SUDOERS_FILE" 2>/dev/null; then
  :
else
  echo "$REVERT_SUDOERS_RULE" >> "$SUDOERS_FILE" && chmod 440 "$SUDOERS_FILE" \
    || say "WARNING: failed to add revert-to-stock sudoers rule; the Revert to stock control will not work until the next successful update"
fi

# --- health check --------------------------------------------------------------
say "Health check (up to 90s)"
HEALTHY=no
HBODY="$STAGE.health"
for _ in $(seq 1 30); do
  sleep 3
  # Log every attempt's HTTP status so a failed update log shows the shape of
  # the failure on its own (000 = no/aborted response, 503 = still starting).
  CODE=$(curl -s -o "$HBODY" -w '%{http_code}' --max-time 5 "http://127.0.0.1:3000/api/deviceStatus" 2>/dev/null || echo 000)
  say "  health attempt: HTTP $CODE"
  [ "$CODE" = 200 ] || continue
  R=$(cat "$HBODY" 2>/dev/null) || continue
  OK=$(printf '%s' "$R" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    assert d['freeSleep']['version'] == '$STAGED_VERSION'
    assert isinstance(d['left']['currentTemperatureF'], (int, float))
    print('yes')
except Exception:
    print('no')" 2>/dev/null)
  [ "$OK" = yes ] && { HEALTHY=yes; break; }
done
[ "$HEALTHY" = yes ] && systemctl is-active free-sleep >/dev/null || HEALTHY=no

if [ "$HEALTHY" = yes ]; then
  say "SUCCESS: pod is serving v$STAGED_VERSION. Previous version kept at $PREV; backup at $BK"
  exit 0
fi

# --- automatic rollback ---------------------------------------------------------
say "Health check FAILED: rolling back to v$CUR_VERSION"
say "Last 60 server log lines from the failed build (for diagnosis):"
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
  fail "update failed but rollback OK (pod back on v$CUR_VERSION). Failed tree kept at $FAILED; see journalctl -u free-sleep"
else
  fail "update failed AND rollback health check failed. Backup tarball: $BK. Check journalctl -u free-sleep. The bed hardware itself keeps running regardless."
fi
