#!/usr/bin/env bash
# Deploy the committed HEAD of this repo to the pod, with backup, staged
# dependency install, atomic swap, health check, and automatic rollback.
#
# Usage: ops/deploy.sh [--check] [--force]
#   --check   run preflight checks only, deploy nothing
#   --force   deploy even if a bed side is on or the git tree is dirty
#
# Auth: uses key auth if available, else sshpass with the password from
# $POD_PASSWORD or ~/.config/free-sleep/pod.pass (never committed).
set -euo pipefail

POD="${POD_HOST:-eight-pod}"          # ssh target (alias, or root@host)
# Health checks below use HTTP, not ssh, so they need a routable host. Resolve
# one without hardcoding a LAN IP, in order: an explicit POD_IP; the ssh config's
# HostName for $POD (covers a user-defined alias); the pod's mDNS name, which the
# stock firmware advertises on the LAN and works with no setup.
if [ -z "${POD_IP:-}" ]; then
  POD_IP=$(ssh -G "$POD" 2>/dev/null | awk '/^hostname /{print $2; exit}')
  # ssh -G echoes the input back when no Host block matches it, which isn't a
  # routable address; fall back to the mDNS name in that case.
  case "${POD_IP:-}" in ""|"$POD") POD_IP="eight-pod.local" ;; esac
fi
LIVE=/home/dac/free-sleep
PREV=/home/dac/free-sleep-prev
STAGE=/home/dac/free-sleep-staging
BACKUPS=/persistent/free-sleep-backups
KEEP_BACKUPS=5
NPM=/home/dac/.volta/bin/npm
NPX=/home/dac/.volta/bin/npx

CHECK_ONLY=0; FORCE=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --force) FORCE=1 ;;
    *) echo "unknown arg: $arg"; exit 2 ;;
  esac
done

say() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

# --- ssh helper -------------------------------------------------------------
# SCP_SHIP carries the one big transfer: it adds its own stall detection, so a
# wedged attempt fails in ~30s instead of waiting out the pod's ~75s, and a
# rate limit (see "ship HEAD to staging" below for why). Options have to sit
# before the destination, which ssh otherwise reads as the remote command.
SHIP_OPTS=(-o ServerAliveInterval=10 -o ServerAliveCountMax=3)
SHIP_RATE_KBIT="${SHIP_RATE_KBIT:-24000}"
if ssh -o BatchMode=yes -o ConnectTimeout=5 "$POD" true 2>/dev/null; then
  SSH() { ssh "$POD" "$@"; }
  SCP_SHIP() { scp "${SHIP_OPTS[@]}" -l "$SHIP_RATE_KBIT" "$1" "$POD:$2"; }
else
  PASS="${POD_PASSWORD:-$(cat "$HOME/.config/free-sleep/pod.pass" 2>/dev/null || true)}"
  [ -n "$PASS" ] || die "no key auth and no password: set POD_PASSWORD or ~/.config/free-sleep/pod.pass"
  command -v sshpass >/dev/null || die "sshpass not installed (brew install sshpass)"
  SSH() { sshpass -p "$PASS" ssh "$POD" "$@"; }
  SCP_SHIP() { sshpass -p "$PASS" scp "${SHIP_OPTS[@]}" -l "$SHIP_RATE_KBIT" "$1" "$POD:$2"; }
fi

# --- preflight: local -------------------------------------------------------
cd "$(dirname "$0")/.."
[ -f server/src/serverInfo.json ] || die "must run from repo root"
git cat-file -e HEAD:server/dist/server.js 2>/dev/null || die "server/dist/server.js missing from HEAD - commit a build first"
git cat-file -e HEAD:server/public/index.html 2>/dev/null || die "server/public/index.html missing from HEAD - commit an app build first"

VERSION=$(git show HEAD:server/src/serverInfo.json | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
COMMIT=$(git rev-parse --short HEAD)

if [ -n "$(git status --porcelain)" ] && [ "$FORCE" -ne 1 ]; then
  die "git tree is dirty; commit your changes or use --force (deploys HEAD, not the working tree)"
fi

# --- preflight: pod ---------------------------------------------------------
say "Preflight: pod state"
SSH "set -e
  [ -d $LIVE ] || { echo 'NO_LIVE_INSTALL'; exit 1; }
  ROOT_FREE=\$(df -m / | awk 'NR==2{print \$4}')
  PERS_FREE=\$(df -m /persistent | awk 'NR==2{print \$4}')
  [ \"\$ROOT_FREE\" -gt 1500 ] || { echo \"LOW_DISK_ROOT: \${ROOT_FREE}M free\"; exit 1; }
  [ \"\$PERS_FREE\" -gt 2000 ] || { echo \"LOW_DISK_PERSISTENT: \${PERS_FREE}M free\"; exit 1; }
  systemctl is-active free-sleep-update.service >/dev/null 2>&1 && { echo 'UPDATE_SERVICE_RUNNING'; exit 1; }
  echo \"disk ok (/ \${ROOT_FREE}M, /persistent \${PERS_FREE}M)\"
" || die "pod preflight failed"

STATUS_JSON=$(curl -sf --max-time 10 "http://$POD_IP:3000/api/deviceStatus") || die "current server not answering; investigate before deploying (ops/rollback.sh or journalctl -u free-sleep)"
POD_VERSION=$(printf '%s' "$STATUS_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["freeSleep"]["version"])')
BED_IN_USE=$(printf '%s' "$STATUS_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("yes" if d["left"]["isOn"] or d["right"]["isOn"] else "no")')
say "Pod is running v$POD_VERSION; deploying v$VERSION ($COMMIT); bed in use: $BED_IN_USE"
if [ "$BED_IN_USE" = "yes" ] && [ "$FORCE" -ne 1 ]; then
  die "a bed side is ON - schedules/alarms pause during deploy. Re-run with --force to proceed anyway."
fi

[ "$CHECK_ONLY" -eq 1 ] && { say "--check passed; nothing deployed"; exit 0; }

# --- backup -----------------------------------------------------------------
TS=$(date +%Y%m%d-%H%M%S)
BK="$BACKUPS/${TS}_v${POD_VERSION}"
say "Backing up code + data to $BK"
SSH "set -e
  mkdir -p '$BK'
  tar czf '$BK/code.tar.gz' -C /home/dac --exclude free-sleep/server/node_modules free-sleep
  cp /persistent/free-sleep-data/free-sleep.db '$BK/' 2>/dev/null || true
  cp -r /persistent/free-sleep-data/lowdb '$BK/lowdb'
  ls -1dt $BACKUPS/*/ | tail -n +$((KEEP_BACKUPS+1)) | xargs -r rm -rf
" || die "backup failed - aborting, nothing changed"

# --- ship HEAD to staging ---------------------------------------------------
# When the deploy host and the pod are both Wi-Fi stations on the same subnet,
# they never talk directly: the access point receives each frame on its radio
# and resends it on that same radio. A sustained upload between two stations
# therefore burns twice the airtime an ordinary download does, and the relay
# gives out well below line rate. Past that point the path wedges rather than
# slowing down, and the transfer eventually dies with "Connection closed by
# remote host" once the pod's sshd has waited out ClientAliveInterval 15 x
# ClientAliveCountMax 4. Measured on one such link: 36 MB lands in 8.7s at
# 4 MB/s, while 6 MB/s and up hang every time. Plain scp and an unrelated HTTP
# pull fail identically, and the pod pulls the same 36 MB from the internet at
# 16 MB/s, so neither the pod, ssh, nor the tree is at fault. Only the relayed
# station-to-station leg is.
#
# So: pace the upload under the cliff instead of letting TCP discover it, keep
# each attempt's own stall detection (fail in ~30s, not the pod's ~75s), retry,
# and confirm the staged tree arrived whole, because a truncated transfer must
# never reach the swap. Raise SHIP_RATE_KBIT on a wired link, where none of
# this applies.
SHIP_ATTEMPTS=4
REMOTE_TAR=/tmp/nightstand-ship.tar
ship_to_stage() {
  local tarball="$1"
  attempt=1
  while [ "$attempt" -le "$SHIP_ATTEMPTS" ]; do
    SSH "rm -rf $STAGE $REMOTE_TAR && mkdir -p $STAGE" || { attempt=$((attempt+1)); continue; }
    if SCP_SHIP "$tarball" "$REMOTE_TAR"; then
      if SSH "tar -x -C $STAGE -f $REMOTE_TAR && rm -f $REMOTE_TAR \
              && [ -s $STAGE/server/dist/server.js ] && [ -s $STAGE/server/public/index.html ]"; then
        [ "$attempt" -gt 1 ] && say "staging ship succeeded on attempt $attempt"
        return 0
      fi
      say "staging ship attempt $attempt arrived incomplete"
    else
      say "staging ship attempt $attempt stalled (the link to the pod, not the tree)"
    fi
    attempt=$((attempt+1))
    [ "$attempt" -le "$SHIP_ATTEMPTS" ] && sleep 3
  done
  return 1
}

say "Shipping git HEAD to staging (paced at ${SHIP_RATE_KBIT} Kbit/s)"
SHIP_TAR=$(mktemp -t nightstand-ship)
trap 'rm -f "$SHIP_TAR"' EXIT
git archive HEAD -o "$SHIP_TAR"
ship_to_stage "$SHIP_TAR" || die "staging ship failed after $SHIP_ATTEMPTS attempts; nothing was changed on the pod"
rm -f "$SHIP_TAR"; trap - EXIT
SSH "chown -R dac:dac $STAGE"

# --- dependencies (while old server still runs) ------------------------------
LOCK_SAME=$(SSH "cmp -s $LIVE/server/package-lock.json $STAGE/server/package-lock.json && echo yes || echo no")
if [ "$LOCK_SAME" = "no" ]; then
  say "package-lock.json changed: npm install in staging (temporarily unblocking WAN)"
  SSH "set -e
    sh $STAGE/scripts/unblock_internet_access.sh >/dev/null
    INSTALL_OK=0
    sudo -u dac bash -c 'cd $STAGE/server && $NPM install --no-audit --no-fund' && INSTALL_OK=1
    sh $STAGE/scripts/block_internet_access.sh >/dev/null || true
    [ \"\$INSTALL_OK\" = 1 ]
  " || { SSH "rm -rf $STAGE"; die "npm install failed - staging discarded, live untouched, WAN re-blocked"; }
else
  say "package-lock.json unchanged: will reuse existing node_modules"
fi

# --- atomic swap ------------------------------------------------------------
say "Swapping (service stops now)"
MOVED_MODULES=no
SSH "set -e
  systemctl stop free-sleep
  rm -rf $PREV
  mv $LIVE $PREV
  mv $STAGE $LIVE
" || die "swap failed - pod may need manual attention: ssh $POD, check $LIVE/$PREV/$STAGE"
if [ "$LOCK_SAME" = "yes" ]; then
  SSH "mv $PREV/server/node_modules $LIVE/server/node_modules && chown -R dac:dac $LIVE/server/node_modules"
  MOVED_MODULES=yes
fi

# prisma: apply any pending migrations (DB already backed up); regenerate client if schema changed
if ! SSH "cmp -s $PREV/server/prisma/schema.prisma $LIVE/server/prisma/schema.prisma"; then
  say "Prisma schema changed: migrate deploy + generate"
  SSH "sudo -u dac bash -c 'cd $LIVE/server && $NPX dotenv -e .env.pod -- npx prisma migrate deploy && $NPX dotenv -e .env.pod -- npx prisma generate'" \
    || echo "WARNING: prisma step failed; health check will decide"
fi

SSH "systemctl start free-sleep"
# jmew's biometrics stream service runs out of the same tree; if it's active,
# bounce it so it picks up the swapped code instead of holding stale handles.
SSH "systemctl try-restart free-sleep-stream 2>/dev/null || true"

# --- health check -----------------------------------------------------------
say "Health check (up to 90s)"
HEALTHY=no
HBODY=$(mktemp)
for i in $(seq 1 30); do
  sleep 3
  # Log every attempt's HTTP status so a failed run shows the shape of the
  # failure on its own (000 = no/aborted response, 503 = still starting).
  CODE=$(curl -s -o "$HBODY" -w '%{http_code}' --max-time 5 "http://$POD_IP:3000/api/deviceStatus" 2>/dev/null || echo 000)
  echo "  health attempt $i: HTTP $CODE"
  [ "$CODE" = "200" ] || continue
  R=$(cat "$HBODY" 2>/dev/null) || continue
  OK=$(printf '%s' "$R" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    assert d['freeSleep']['version']=='$VERSION'
    assert isinstance(d['left']['currentTemperatureF'],(int,float))
    print('yes')
except Exception:
    print('no')" 2>/dev/null)
  [ "$OK" = "yes" ] && { HEALTHY=yes; break; }
done
rm -f "$HBODY"

if [ "$HEALTHY" = "yes" ]; then
  SSH "systemctl is-active free-sleep >/dev/null" || HEALTHY=no
fi

if [ "$HEALTHY" = "yes" ]; then
  say "SUCCESS: pod is serving v$VERSION ($COMMIT). Previous version kept at $PREV; backup at $BK"
  exit 0
fi

# --- automatic rollback -----------------------------------------------------
printf '\033[1;31m==> Health check FAILED - rolling back to v%s\033[0m\n' "$POD_VERSION"
say "Last 60 server log lines from the failed build (for diagnosis)"
SSH "tail -n 60 /persistent/free-sleep-data/logs/free-sleep.log 2>/dev/null" || echo "  (no server log available)"
SSH "set -e
  systemctl stop free-sleep || true
  rm -rf /home/dac/free-sleep-failed
  mv $LIVE /home/dac/free-sleep-failed
  mv $PREV $LIVE
  if [ '$MOVED_MODULES' = yes ]; then mv /home/dac/free-sleep-failed/server/node_modules $LIVE/server/node_modules; fi
  systemctl start free-sleep
"
sleep 8
if curl -sf --max-time 5 "http://$POD_IP:3000/api/deviceStatus" >/dev/null; then
  die "deploy failed but ROLLBACK OK (pod back on v$POD_VERSION). Failed tree kept at /home/dac/free-sleep-failed; logs: ssh $POD journalctl -u free-sleep -n 100"
else
  die "deploy failed AND rollback health check failed. SSH in: journalctl -u free-sleep -n 100. Backup tarball: $BK. Bed hardware itself keeps running regardless."
fi
