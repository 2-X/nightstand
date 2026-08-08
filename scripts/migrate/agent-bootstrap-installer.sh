#!/bin/bash
# Pod-side half of the agent bootstrap. Pushed to the target pod by
# ops/bootstrap-agent.sh and started detached, so a dropped laptop connection
# changes nothing here.
#
# This is the smaller sibling of pod-installer.sh. That tool migrates a pod
# from another fork onto this whole tree; this one takes a pod running stock
# upstream and adds only the agent: the updater, rollback and revert
# machinery. Nothing else changes, which is the whole claim of this rung.
#
# DESIGN CREED, inherited verbatim from pod-installer.sh and not diluted here:
# this tool must be unable to make anyone's night worse. Every stage below is
# either read-only, staged-and-reversible, or covered by an automatic restore
# that fires even if this script itself is killed. The firmware and temperature
# control are never touched (ops/ANTIBRICK.md), and the worst reachable state
# is "the free-sleep web layer is down and the original install comes back on
# its own".
#
# Ordering principle, same as its sibling: everything expensive and failable
# happens BEFORE the running service is touched. By the time their service
# stops, the staged tree is already assembled and verified.
#
# The overlay is applied to a COPY of the pod's own stock install, never to a
# tree we shipped wholesale. That matters: the agent's claim is zero behavior
# change against the stock a pod already runs, and swapping in our own idea of
# stock would quietly replace their upstream code with ours.
set -uo pipefail

LIVE=/home/dac/free-sleep
PREV=/home/dac/free-sleep-prev
# Same constants as pod-installer.sh on purpose. Both tools swap LIVE and PREV
# and both are one-at-a-time operations, so they share restore-original-fork.sh
# unchanged rather than each carrying its own copy of that careful logic. The
# name reads correctly here too: the original install IS stock, and restoring
# puts stock back.
PREEXISTING_PREV=/home/dac/free-sleep-prev-preexisting
SWAP_MARKER=/home/dac/free-sleep-migrate-swapped
STAGE=/home/dac/free-sleep-agent-staging
PAYLOAD=/home/dac/free-sleep-agent-payload
LOCK_FILE=/home/dac/free-sleep-agent-bootstrap.lock
STATUS_FILE=/persistent/free-sleep-data/migration-status.json
RESTORE_SCRIPT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/restore-original-fork.sh"
RESTORE_SCRIPT_DEST=/home/dac/restore-original-fork.sh
SENTINEL_SERVICE=free-sleep-migrate-sentinel.service
SENTINEL_TIMER=free-sleep-migrate-sentinel.timer
SENTINEL_MINUTES=12
LOG_FILE="/persistent/free-sleep-data/logs/agent-bootstrap-$(date +%Y%m%d-%H%M%S).log"

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
exec > >(tee -a "$LOG_FILE") 2>&1

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

write_status() {
  mkdir -p "$(dirname "$STATUS_FILE")" 2>/dev/null || true
  printf '{"stage":"%s","outcome":"%s","message":"%s","timestamp":"%s"}\n' \
    "$1" "$2" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATUS_FILE" 2>/dev/null || true
}

if [ -e "$LOCK_FILE" ]; then
  say "FATAL: $LOCK_FILE exists, a bootstrap is already running or a previous run left it behind."
  write_status "preflight" "refused" "lock file present"
  exit 1
fi
: > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

fail() {
  say "FATAL: $*"
  write_status "install" "failed" "$*"
  exit 1
}

# ==============================================================================
# Preflight. Their server is running and untouched below this line.
# ==============================================================================
for unit in free-sleep-update.service free-sleep-rollback.service; do
  if systemctl is-active --quiet "$unit" 2>/dev/null; then
    fail "$unit is active, refusing to bootstrap while an updater is running"
  fi
done

[ -d "$LIVE" ] || fail "no install at $LIVE; the agent overlays an existing stock install, it does not create one"
[ -f "$LIVE/server/package.json" ] || fail "no server/package.json under $LIVE; this does not look like a free-sleep install"
[ -d "$PAYLOAD" ] || fail "no agent payload at $PAYLOAD; the laptop half should have pushed it"
[ -f "$PAYLOAD/MANIFEST" ] || fail "payload has no MANIFEST; refusing to guess which files are the agent"

# Refuse anything that is not stock. An agent on top of a tree that already
# carries the agent, or on top of another fork, is not this rung and its
# reversibility story does not hold.
if [ -f "$LIVE/server/src/routes/update/update.ts" ] || [ -d "$LIVE/server/src/agent" ]; then
  fail "this pod already carries agent files; use the in-app updater, not the bootstrap"
fi
if grep -q "routes/update/update.js" "$LIVE/server/src/setup/routes.ts" 2>/dev/null; then
  fail "this pod's routes.ts already registers an update route; not stock, refusing"
fi

ROOT_FREE=$(df -m / | awk 'NR==2{print $4}')
[ "${ROOT_FREE:-0}" -gt 1000 ] || fail "low disk on / (${ROOT_FREE}M free), aborting before touching anything"

# ==============================================================================
# Stage: a copy of THEIR stock, with the agent applied to the copy.
# ==============================================================================
write_status "stage" "in_progress" "copying the stock install"
say "Copying the pod's own stock install to $STAGE (their tree stays untouched)"
rm -rf "$STAGE"
cp -a "$LIVE" "$STAGE" || fail "could not copy the stock install; nothing was touched"

say "Applying the agent overlay to the copy"
while IFS='|' read -r mode path; do
  [ -n "${path:-}" ] || continue
  src="$PAYLOAD/files/$path"
  dest="$STAGE/$path"
  case "$mode" in
    add)
      [ -e "$dest" ] && fail "manifest says add but $path already exists in stock; the base moved"
      mkdir -p "$(dirname "$dest")"
      cp "$src" "$dest" || fail "could not add $path"
      ;;
    copy)
      [ -e "$dest" ] || fail "manifest says copy but $path is absent from stock; the base moved"
      cp "$src" "$dest" || fail "could not replace $path"
      ;;
    patch)
      # Handled below. Patches touch the pod's own file, so they cannot be
      # shipped as whole-file copies without dragging this tree's content in.
      ;;
    *)
      fail "unknown manifest mode '$mode' for $path"
      ;;
  esac
done < "$PAYLOAD/MANIFEST"

# Patch 1: register the update route. Two lines is the whole difference.
ROUTES="$STAGE/server/src/setup/routes.ts"
python3 - "$ROUTES" <<'PY' || fail "routes.ts patch failed"
import sys
p = sys.argv[1]
s = open(p).read()
if "routes/update/update.js" in s:
    sys.exit("routes.ts already imports the update route")
anchor = "import logger from '../logger.js';"
if anchor not in s:
    sys.exit("routes.ts does not carry the expected import anchor; this base needs a human")
s = s.replace(anchor, "import update from '../routes/update/update.js';\n" + anchor, 1)
reg = "  app.use('/api/', settings);"
if reg not in s:
    sys.exit("routes.ts does not carry the expected registration anchor; this base needs a human")
s = s.replace(reg, reg + "\n  app.use('/api/', update);", 1)
open(p, "w").write(s)
PY
grep -q "routes/update/update.js" "$ROUTES" || fail "routes.ts import patch did not apply"
grep -q "app.use('/api/', update);" "$ROUTES" || fail "routes.ts registration patch did not apply"

# Patch 2: the test script entry. The agent carries the first test files this
# install has ever had, and stock has no runner entry to run them with.
python3 - "$STAGE/server/package.json" "$PAYLOAD/test-script" <<'PY' || fail "package.json patch failed"
import json, sys
pkg_path, script_path = sys.argv[1], sys.argv[2]
pkg = json.load(open(pkg_path))
if pkg.get("scripts", {}).get("test"):
    sys.exit("stock already has a test script; the patch is obsolete")
pkg.setdefault("scripts", {})["test"] = open(script_path).read().strip()
open(pkg_path, "w").write(json.dumps(pkg, indent=2) + "\n")
PY

[ -f "$STAGE/server/dist/server.js" ] || fail "staged tree is missing server/dist/server.js"
[ -f "$STAGE/server/public/index.html" ] || fail "staged tree is missing server/public/index.html"
chown -R dac:dac "$STAGE"
write_status "stage" "ok" "agent applied to a copy of stock"

# ==============================================================================
# Dead-man sentinel, armed immediately before we touch their service.
# ==============================================================================
say "Arming dead-man sentinel (auto-restores their install in ${SENTINEL_MINUTES}m if this script dies)"
cp "$RESTORE_SCRIPT_SRC" "$RESTORE_SCRIPT_DEST" || fail "could not stage the restore script"
chmod +x "$RESTORE_SCRIPT_DEST"

cat > "/etc/systemd/system/$SENTINEL_SERVICE" <<EOF
[Unit]
Description=Agent bootstrap dead-man restore (fires only if the sentinel timer elapses)

[Service]
Type=oneshot
ExecStart=/bin/bash $RESTORE_SCRIPT_DEST
EOF

cat > "/etc/systemd/system/$SENTINEL_TIMER" <<EOF
[Unit]
Description=Agent bootstrap dead-man sentinel, restores the original install if the installer never disarms this

[Timer]
OnActiveSec=${SENTINEL_MINUTES}min
Persistent=true
Unit=$SENTINEL_SERVICE

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "$SENTINEL_TIMER" || fail "could not arm the dead-man sentinel; refusing to proceed without it"

disarm_sentinel() {
  systemctl disable --now "$SENTINEL_TIMER" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$SENTINEL_SERVICE" "/etc/systemd/system/$SENTINEL_TIMER" 2>/dev/null || true
  systemctl daemon-reload >/dev/null 2>&1 || true
}

restore_and_report() {
  say "Restoring their original install via $RESTORE_SCRIPT_DEST..."
  bash "$RESTORE_SCRIPT_DEST"
  disarm_sentinel
  write_status "install" "restored" "$1"
}

# ==============================================================================
# Swap
# ==============================================================================
write_status "swap" "in_progress" "stopping the running service"
say "Stopping their service (their tree is untouched up to this point)"
systemctl stop free-sleep >/dev/null 2>&1 || true
systemctl stop free-sleep-stream >/dev/null 2>&1 || true

rm -rf "$PREEXISTING_PREV"
if [ -d "$PREV" ]; then
  say "Pod already keeps a rollback tree at $PREV, setting it aside as $PREEXISTING_PREV"
  mv "$PREV" "$PREEXISTING_PREV" || { restore_and_report "could not set aside the existing rollback slot"; exit 1; }
fi
: > "$SWAP_MARKER"
mv "$LIVE" "$PREV" || { restore_and_report "could not move their tree aside"; exit 1; }
mv "$STAGE" "$LIVE" || { restore_and_report "could not move the staged tree into place"; exit 1; }
chown -R dac:dac "$LIVE"

say "Installing the agent's systemd units..."
cp "$LIVE/scripts/systemd/free-sleep-rollback.service" /etc/systemd/system/ 2>/dev/null || true
cp "$LIVE/scripts/systemd/free-sleep-revert.service" /etc/systemd/system/ 2>/dev/null || true
systemctl daemon-reload
# NB: both units are STATIC, on-demand oneshots the app starts when the user
# clicks Roll back or Revert to stock. Do NOT `enable --now` them: --now would
# execute the action immediately, undoing this install before the health check
# even runs. Installing the unit files is all they need to be startable.

systemctl start free-sleep || { restore_and_report "the service failed to start after the overlay"; exit 1; }
systemctl start free-sleep-stream >/dev/null 2>&1 || true

# --- health check (same shape as update.sh and pod-installer.sh) --------------
say "Health check: waiting for /api/deviceStatus to answer 200"
HEALTHY=0
for _ in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/api/deviceStatus 2>/dev/null || echo 000)
  if [ "$CODE" = "200" ]; then HEALTHY=1; break; fi
  sleep 5
done

if [ "$HEALTHY" != "1" ]; then
  restore_and_report "the server did not answer 200 after the overlay"
  exit 1
fi

rm -f "$SWAP_MARKER"
disarm_sentinel
say "Agent bootstrap complete. Their stock tree is kept at $PREV for instant rollback."
write_status "install" "ok" "agent installed on stock"
