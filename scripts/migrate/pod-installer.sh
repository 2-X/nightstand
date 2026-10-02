#!/bin/bash
# Pod-side half of the fork-switch tool.
# Pushed to the target pod by scripts/migrate/switch-to-this-fork.sh and
# started detached (systemd-run, falling back to nohup) so a dropped laptop
# connection changes nothing here.
#
# The installer stages the replacement and keeps the previous install.
# A timed restore attempts to bring it back if migration stops.
# It does not modify Eight Sleep's firmware files; it does block the Pod's
# internet access. Schedules and alarms pause while the server is stopped.
# Recovery can still require SSH or a firmware reset. See ops/ANTIBRICK.md.
#
# Ordering principle: everything expensive and failable happens BEFORE the
# swap, while their server is still running untouched. By the time we stop
# their service, download/verify/npm-install/data-compat-check have all
# already succeeded against the STAGE directory.
#
# Requires: their install already backed up (pod tarball + laptop copy) by
# switch-to-this-fork.sh's Stage 4, BEFORE this script ever runs.
set -uo pipefail

REPO_DIR_SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LIVE=/home/dac/free-sleep
PREV=/home/dac/free-sleep-prev
# The pod's own updater may already keep a rollback tree at $PREV. We set it
# aside here rather than destroy it, and drop $SWAP_MARKER the instant we start
# mutating $LIVE so restore-original-fork.sh keys off "did WE swap", not the
# mere existence of $PREV, which could be the pod's own pre-existing slot.
PREEXISTING_PREV=/home/dac/free-sleep-prev-preexisting
SWAP_MARKER=/home/dac/free-sleep-migrate-swapped
STAGE=/home/dac/free-sleep-migrate-staging
ZIP=/home/dac/free-sleep-migrate.zip
LOCK_FILE=/home/dac/free-sleep-migrate.lock
PID_FILE=/home/dac/free-sleep-migrate.pid
DB_PREFLIGHT=""
STATUS_FILE=/persistent/free-sleep-data/migration-status.json
IPTABLES_SNAPSHOT=/home/dac/free-sleep-migrate-iptables-snapshot.rules
RESTORE_SCRIPT_SRC="$REPO_DIR_SELF/migrate/restore-original-fork.sh"
RESTORE_SCRIPT_DEST=/home/dac/restore-original-fork.sh
BASELINE_FILE=/home/dac/free-sleep-migrate-baseline.json
SENTINEL_SERVICE=free-sleep-migrate-sentinel.service
SENTINEL_TIMER=free-sleep-migrate-sentinel.timer
SENTINEL_MINUTES=12
LOG_FILE="/persistent/free-sleep-data/logs/migration-$(date +%Y%m%d-%H%M%S).log"
NPM=/home/dac/.volta/bin/npm
NPX=/home/dac/.volta/bin/npx

RELEASES_URL="https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json"
# main only moves at a release, so its tip is always the newest release.
MAIN_ZIP_URL="https://github.com/LTimothy/nightstand/archive/refs/heads/main.zip"

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
exec > >(tee -a "$LOG_FILE") 2>&1

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

write_status() {
  # $1=stage $2=outcome $3=message, best-effort, never fatal.
  mkdir -p "$(dirname "$STATUS_FILE")" 2>/dev/null || true
  printf '{"stage":"%s","outcome":"%s","message":"%s","timestamp":"%s"}\n' \
    "$1" "$2" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATUS_FILE" 2>/dev/null || true
}

# --- lock: refuse concurrent runs, refuse if any fork's updater is active ----
if [ -e "$LOCK_FILE" ]; then
  say "FATAL: $LOCK_FILE exists, a migration is already in progress or a previous run left it behind."
  write_status "preflight" "refused" "lock file present; refusing to start a second migration"
  exit 1
fi
: > "$LOCK_FILE"
echo "$$" > "$PID_FILE"
cleanup_lock() {
  rm -f "$LOCK_FILE" "$PID_FILE" "$ZIP" /tmp/free-sleep-migrate-health
  rm -rf "$STAGE" "$STAGE.unzip"
  if [ -n "$DB_PREFLIGHT" ]; then rm -rf "$DB_PREFLIGHT"; fi
}
trap cleanup_lock EXIT

for unit in free-sleep-update.service free-sleep-rollback.service; do
  if systemctl is-active --quiet "$unit" 2>/dev/null; then
    say "FATAL: $unit is currently active, refusing to migrate while any fork's own updater is running."
    write_status "preflight" "refused" "$unit is active"
    exit 1
  fi
done

fail() {
  say "FATAL: $*"
  write_status "install" "failed" "$*"
  exit 1
}

# Free-space helpers, kept identical in update.sh, revert-to-stock.sh,
# migrate/pod-installer.sh, migrate/switch-to-this-fork.sh and ops/deploy.sh.
# Sizes are whole MB, rounded up, and a missing path counts as 0.
# SPACE_MARGIN_MB stays free for the firmware, the server and the logs while
# the operation runs, and covers a release a little larger than the one
# installed.
SPACE_MARGIN_MB=64
free_mb() { { df -kP "$1" 2>/dev/null || true; } | awk 'NR == 2 { print int($4 / 1024) }'; }
size_mb() { { du -sk "$@" 2>/dev/null || true; } | awk '{ kb += $1 } END { print int((kb + 1023) / 1024) }'; }
# The Node version a tree pins for Volta, empty when it pins none.
node_pin() {
  python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("volta", {}).get("node", ""))' \
    "$1/server/package.json" 2>/dev/null || true
}
# Volta fetches a pinned Node the first time npm or npx runs under it. For
# 24.11.0 on arm64 that is a 56 MB archive it keeps plus 207 MB unpacked.
# $1 is the version wanted, $2 the one already in use (empty if unknown).
node_fetch_mb() {
  if [ -n "$1" ] && [ "$1" != "$2" ] && [ ! -d "/home/dac/.volta/tools/image/node/$1" ]; then
    echo 280
  else
    echo 0
  fi
}

# ==============================================================================
# Stage: pre-swap (their server is still running and untouched below this line)
# ==============================================================================
write_status "resolve" "in_progress" "resolving the newest release"

say "Resolving the newest release from releases.json..."
RELEASES_JSON=$(curl -fsSL --max-time 20 "$RELEASES_URL") \
  || fail "could not fetch releases.json, check the pod's WAN access"
TARGET_VERSION=$(printf '%s' "$RELEASES_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(data['releases'][0]['version'] if data['releases'] else '')
") || fail "could not parse releases.json"
[ -n "$TARGET_VERSION" ] || fail "no release found in releases.json"
say "Target: v$TARGET_VERSION (newest release)"
write_status "resolve" "ok" "target v$TARGET_VERSION"

# switch-to-this-fork.sh pushes its own Stage 2 (pre-consent) snapshot to
# this exact path before starting this script, that's the authoritative
# one (every abort path must restore the state the pod was in when the user
# typed "switch", not whatever it drifts to during staging). Only take a
# fresh one here if this script is somehow being run standalone.
if [ -f "$IPTABLES_SNAPSHOT" ]; then
  say "Using the pre-consent iptables snapshot pushed by switch-to-this-fork.sh"
else
  say "No pushed iptables snapshot found, taking one now (standalone run?)"
  iptables-save > "$IPTABLES_SNAPSHOT" 2>/dev/null || say "WARNING: could not snapshot iptables"
fi

# Room for what this installer writes. Their install says little about the
# size of ours, so the release is never counted below 64 MB unpacked and
# 400 MB of node_modules (3.5.1 measured 47 MB and 330 MB on arm64). On /:
# the download and its unpacked tree, a fresh node_modules plus a third of
# that again for npm's and Prisma's caches (68 and 33 MB from empty for
# 330 MB), and the database copy the compatibility check migrates; a Node
# that Volta must fetch is checked once staged. On /persistent: the database snapshot, plus
# half the database again for the live migration, which only ever adds.
MODULES_MB=$(size_mb "$LIVE/server/node_modules")
TREE_MB=$(( $(size_mb "$LIVE") - MODULES_MB ))
[ "$TREE_MB" -ge 64 ] || TREE_MB=64
[ "$MODULES_MB" -ge 400 ] || MODULES_MB=400
DB_MB=$(size_mb /persistent/free-sleep-data/free-sleep.db /persistent/free-sleep-data/free-sleep.db-wal)
ROOT_NEED=$(( 2 * TREE_MB + MODULES_MB + MODULES_MB / 3 + DB_MB + DB_MB / 2 + SPACE_MARGIN_MB ))
PERS_NEED=$(( DB_MB + DB_MB / 2 + SPACE_MARGIN_MB ))
ROOT_FREE=$(free_mb /)
PERS_FREE=$(free_mb /persistent)
[ "${ROOT_FREE:-0}" -ge "$ROOT_NEED" ] || fail "low disk on / (${ROOT_FREE:-unknown}M free, ${ROOT_NEED}M needed), aborting before touching anything"
[ "${PERS_FREE:-0}" -ge "$PERS_NEED" ] \
  || fail "low disk on /persistent (${PERS_FREE:-unknown}M free, ${PERS_NEED}M needed), aborting before touching anything; old snapshots in /persistent/free-sleep-database-backups/ can be removed to make room"

say "Downloading v$TARGET_VERSION (the tip of main)..."
curl -fL --max-time 300 -o "$ZIP" "$MAIN_ZIP_URL" \
  || fail "download failed; their server was never touched"
rm -rf "$STAGE" "$STAGE.unzip"
unzip -q "$ZIP" -d "$STAGE.unzip" || fail "unzip failed; their server was never touched"
STAGE_INNER=$(find "$STAGE.unzip" -mindepth 1 -maxdepth 1 -type d | head -n1)
[ -n "$STAGE_INNER" ] || fail "unexpected zip layout; their server was never touched"
mv "$STAGE_INNER" "$STAGE" && rm -rf "$STAGE.unzip"
rm -f "$ZIP"
chown -R dac:dac "$STAGE"

[ -f "$STAGE/server/dist/server.js" ] || fail "staged tree is missing server/dist/server.js"
[ -f "$STAGE/server/public/index.html" ] || fail "staged tree is missing server/public/index.html"
STAGED_FORK=$(python3 -c 'import json;print(json.load(open("'"$STAGE"'/server/src/serverInfo.json"))["fork"])' 2>/dev/null) \
  || fail "staged tree has no readable serverInfo.json"
[ "$STAGED_FORK" = "LTimothy/nightstand" ] || fail "staged tree's fork field is '$STAGED_FORK', not this fork, refusing"
STAGED_VERSION=$(python3 -c 'import json;print(json.load(open("'"$STAGE"'/server/src/serverInfo.json"))["version"])')
[ "$STAGED_VERSION" = "$TARGET_VERSION" ] || fail "staged tree reports v$STAGED_VERSION but v$TARGET_VERSION was requested"

say "Verifying artifact hashes against releases.json..."
# releases.json is passed via stdin (not interpolated into the python source)
# so nothing in it can break bash or python quoting.
ARTIFACT_CHECK=$(printf '%s' "$RELEASES_JSON" | STAGE_DIR="$STAGE" TARGET_VER="$TARGET_VERSION" python3 -c "
import json, hashlib, sys, os
data = json.load(sys.stdin)
head = data['releases'][0]
artifacts = head.get('artifacts') or {}
if head['version'] != os.environ['TARGET_VER']:
    print('head-mismatch'); sys.exit(0)
for relpath, expected in artifacts.items():
    with open(os.path.join(os.environ['STAGE_DIR'], relpath), 'rb') as f:
        actual = 'sha256:' + hashlib.sha256(f.read()).hexdigest()
    if actual != expected:
        print('mismatch:' + relpath); sys.exit(0)
print('ok')
" 2>/dev/null || echo "check-failed")
case "$ARTIFACT_CHECK" in
  ok|head-mismatch) : ;; # head-mismatch = target isn't manifest head (e.g. artifacts only present for head); not an error
  *) fail "artifact hash check failed ($ARTIFACT_CHECK), download may be corrupt or the wrong tag" ;;
esac

# What / still takes now that the release is staged: the Node ensure-node.sh
# installs if Volta lacks it, the dependency install with its caches, and the
# database copy the compatibility check migrates.
DEPS_NEED=$(( $(node_fetch_mb "$(node_pin "$STAGE")" "") + MODULES_MB + MODULES_MB / 3 + DB_MB + DB_MB / 2 + SPACE_MARGIN_MB ))
ROOT_FREE=$(free_mb /)
[ "${ROOT_FREE:-0}" -ge "$DEPS_NEED" ] \
  || fail "low disk on / (${ROOT_FREE:-unknown}M free, ${DEPS_NEED}M needed for the new dependencies); their server was never touched"

say "Ensuring Node/Volta toolchain (shared with install.sh)..."
bash "$STAGE/scripts/ensure-node.sh" dac || fail "node/volta bootstrap failed; their server was never touched"

say "Installing dependencies in staging (always, lockfiles differ across forks)..."
sudo -u dac bash -c "cd '$STAGE/server' && '$NPM' install --no-audit --no-fund" \
  || fail "npm install failed; their server was never touched"

say "Smoke-testing the staged build (syntax check only, never execute it here, their server still owns port 3000)..."
node --check "$STAGE/server/dist/server.js" \
  || fail "staged server.js failed a syntax check; their server was never touched"

say "Data-compatibility dry run (report-only, nothing is written)..."
if [ -f "$STAGE/scripts/migrate/data-compat-check.mjs" ]; then
  if ! node "$STAGE/scripts/migrate/data-compat-check.mjs"; then
    fail "data-compat dry run found destructive changes to your settings/schedules; their server was never touched. See the report above."
  fi
else
  say "WARNING: data-compat-check.mjs missing from staged tree; skipping (older release predates this check)"
fi

# Database compatibility preflight runs the real target migrations against a
# consistent snapshot. A divergent fork must fail here, before either tree is
# moved or the live migration ledger is changed.
say "Database compatibility preflight on an isolated snapshot..."
DATABASE=/persistent/free-sleep-data/free-sleep.db
[ -f "$STAGE/scripts/sqlite-safety.py" ] || fail "staged release lacks the database safety helper"
if [ -f "$DATABASE" ]; then
  DATABASE_BACKUP="/persistent/free-sleep-database-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$-migration.db"
  python3 "$STAGE/scripts/sqlite-safety.py" backup "$DATABASE" "$DATABASE_BACKUP" \
    || fail "database snapshot failed; original install was not changed"
  DB_PREFLIGHT=$(mktemp -d "$STAGE/.database-preflight.XXXXXX") \
    || fail "could not create database preflight directory"
  python3 "$STAGE/scripts/sqlite-safety.py" backup "$DATABASE_BACKUP" "$DB_PREFLIGHT/check.db" \
    || fail "could not prepare database preflight snapshot"
  chown -R dac:dac "$DB_PREFLIGHT" || fail "could not set database preflight ownership"
  sudo -u dac bash -c "cd '$STAGE/server' && DATABASE_URL='file:$DB_PREFLIGHT/check.db' '$NPX' prisma migrate deploy" \
    || fail "database histories are incompatible; original install and database were not changed. Do not reset the database"
  rm -rf "$DB_PREFLIGHT"
  DB_PREFLIGHT=""
  say "Database snapshot retained at $DATABASE_BACKUP"
fi

# ==============================================================================
# Dead-man sentinel, armed immediately before we touch their service.
# ==============================================================================
say "Arming dead-man sentinel (auto-restores their fork in ${SENTINEL_MINUTES}m if this script dies)"
cp "$RESTORE_SCRIPT_SRC" "$RESTORE_SCRIPT_DEST"
chmod +x "$RESTORE_SCRIPT_DEST"

cat > "/etc/systemd/system/$SENTINEL_SERVICE" <<EOF
[Unit]
Description=Fork-switch dead-man restore (fires only if the sentinel timer elapses)

[Service]
Type=oneshot
ExecStart=/bin/bash $RESTORE_SCRIPT_DEST --sentinel
EOF

cat > "/etc/systemd/system/$SENTINEL_TIMER" <<EOF
[Unit]
Description=Fork-switch dead-man sentinel, restores the original fork if the installer never disarms this

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
  say "Restoring their original fork via $RESTORE_SCRIPT_DEST..."
  if ! bash "$RESTORE_SCRIPT_DEST"; then
    write_status "install" "restore_failed" "$1; original install could not be restored"
    say "FATAL: restore failed; leaving the sentinel armed for another attempt"
    exit 1
  fi
  disarm_sentinel
  write_status "install" "restored" "$1"
}

# ==============================================================================
# Swap
# ==============================================================================
write_status "swap" "in_progress" "stopping original service"
say "Stopping their service (their tree is untouched up to this point)"
systemctl stop free-sleep >/dev/null 2>&1 \
  || { restore_and_report "could not stop original server"; exit 1; }
if systemctl cat free-sleep-stream >/dev/null 2>&1; then
  systemctl stop free-sleep-stream >/dev/null 2>&1 \
    || { restore_and_report "could not stop original streamer"; exit 1; }
fi
if [ -f "$DATABASE" ]; then
  python3 "$STAGE/scripts/sqlite-safety.py" checkpoint "$DATABASE" \
    || { restore_and_report "database checkpoint failed before swap"; exit 1; }
fi

# Preserve the pod's own rollback slot instead of rm -rf'ing it: destroying it
# would throw away their instant-rollback history and, worse, leave a stale tree
# at $PREV that a later restore could mistake for the install we swapped out.
rm -rf "$PREEXISTING_PREV"
if [ -d "$PREV" ]; then
  say "Pod already keeps a rollback tree at $PREV, setting it aside as $PREEXISTING_PREV"
  mv "$PREV" "$PREEXISTING_PREV" || { restore_and_report "could not set aside the pod's existing rollback slot"; exit 1; }
fi
# From this marker on, $LIVE is being mutated; restore-original-fork.sh must run
# to completion if we die past here. It is removed only after a passed health check.
: > "$SWAP_MARKER"
if [ -d "$LIVE" ]; then
  mv "$LIVE" "$PREV" || { restore_and_report "could not move their tree aside"; exit 1; }
fi
mv "$STAGE" "$LIVE" || {
  # $LIVE is already gone (moved to $PREV above), do NOT also move $PREV
  # back here ourselves; restore-original-fork.sh's job is exactly this
  # move, and doing it twice would leave it looking at a $LIVE that already
  # has their tree and no $PREV, misreporting "no swap in progress".
  restore_and_report "could not move staged tree into place"
  exit 1
}
chown -R dac:dac "$LIVE"

say "Installing the RAW-archive timer units..."
cp "$LIVE/scripts/systemd/free-sleep-archive-raw.service" "$LIVE/scripts/systemd/free-sleep-archive-raw.timer" /etc/systemd/system/ 2>/dev/null || true
systemctl daemon-reload

say "Running prisma migrate deploy (additive by standing rule)..."
sudo -u dac bash -c "cd '$LIVE/server' && '$NPX' dotenv -e .env.pod -- npx prisma migrate deploy && '$NPX' dotenv -e .env.pod -- npx prisma generate" \
  || { restore_and_report "prisma migration or client generation failed"; exit 1; }
sudo -u dac bash -c "cd '$LIVE/server' && '$NPX' dotenv -e .env.pod -- npx prisma migrate status" \
  || { restore_and_report "database migration status failed; compare the migration histories of both forks and resolve compatibility before retrying. Do not reset the database"; exit 1; }

systemctl start free-sleep || { restore_and_report "our service failed to start"; exit 1; }
# The swap above stopped free-sleep-stream (its ExecStart lives inside the tree
# we just moved). It's a continuously-running biometrics/presence streamer
# (enabled, Restart=always) that nothing else brings back, so start it here or
# live biometrics stay dark until the next reboot. Best-effort: a pod without a
# separate stream service (older layouts) simply has nothing to start.
systemctl start free-sleep-stream >/dev/null 2>&1 || true
systemctl enable --now free-sleep-archive-raw.timer >/dev/null 2>&1 || true
# NB: free-sleep-rollback.service is a STATIC, on-demand oneshot that swaps
# $LIVE <-> $PREV when the user clicks "Roll back". Never `enable --now` it:
# that would run a rollback right now, before the health check. It is
# installed, without being started, by setup_services.sh after the check passes.

# --- health check (same shape as update.sh/rollback_pod.sh) --------------------
# Pass condition: the new server answers /api/deviceStatus with HTTP 200 AND
# reports our staged version. A 200 (not the fast 503 we deliberately return
# while Franken is still connecting) already proves the hub link is up, so that
# is the health signal. We do NOT additionally require per-side temperatures to
# have populated: currentTemperatureF legitimately reads null for the first read
# cycles after a cold Franken connect (the heat level hasn't been sampled yet),
# and gating on it turned a genuinely healthy migration into a false failure
# that auto-restored a working install. A side that had a temperature before but
# doesn't yet is surfaced as a NOTE, never a failure.
say "Health check (up to 90s)"
HEALTHY=no
TEMP_LAGGING=""
HBODY=/tmp/free-sleep-migrate-health
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
    print('no')
" 2>/dev/null)
  [ "$OK" = yes ] && { HEALTHY=yes; break; }
done
# Non-fatal observability only: note any side that reported a temperature before
# the swap but hasn't repopulated one yet, so a real regression is still visible
# in the log without failing an otherwise-healthy migration.
if [ "$HEALTHY" = yes ]; then
  TEMP_LAGGING=$(cat "$HBODY" 2>/dev/null | BASELINE_FILE="$BASELINE_FILE" python3 -c "
import json, sys, os
try:
    d = json.load(sys.stdin)
    baseline_path = os.environ.get('BASELINE_FILE')
    baseline = json.load(open(baseline_path)) if baseline_path and os.path.exists(baseline_path) else {}
    lagging = [s for s in ('left', 'right')
               if isinstance(baseline.get(s), (int, float))
               and not isinstance(d.get(s, {}).get('currentTemperatureF'), (int, float))]
    print(','.join(lagging))
except Exception:
    print('')
" 2>/dev/null)
fi
rm -f "$HBODY"
[ "$HEALTHY" = yes ] && systemctl is-active free-sleep >/dev/null || HEALTHY=no

if [ "$HEALTHY" != yes ]; then
  say "Health check FAILED. Last 60 log lines:"
  tail -n 60 /persistent/free-sleep-data/logs/free-sleep.log 2>/dev/null || say "  (no log available)"
  restore_and_report "post-swap health check failed"
  exit 1
fi
if [ -n "$TEMP_LAGGING" ]; then
  say "NOTE: side(s) [$TEMP_LAGGING] are not yet reporting a numeric temperature, normal for the first read cycles after a cold Franken connect; it should populate within a minute. The migration is healthy."
fi

# ==============================================================================
# Success: apply our WAN policy, disarm the sentinel, report.
# ==============================================================================
say "Health check passed on v$STAGED_VERSION."
# The same units, sudoers rules, memory limits, and shortcuts install.sh sets
# up, so updates, rollback, and switching to upstream free-sleep work without
# relying on whatever the previous fork left. Done only after the health check,
# so a failed install restores their fork without any of it. The memory limits
# apply from the service's next restart.
say "Installing the updater, rollback, and revert services and their sudoers rules..."
bash "$LIVE/scripts/setup_services.sh" "$LIVE" \
  || say "WARNING: some services or sudoers rules could not be installed; the next in-app update retries them"
bash "$LIVE/scripts/setup_resource_limits.sh" >/dev/null 2>&1 \
  || say "WARNING: could not install the service memory limits"
bash "$LIVE/scripts/add_shortcuts.sh" >/dev/null 2>&1 \
  || say "WARNING: could not install the fs-* shell shortcuts"

say "Applying this fork's WAN policy..."
sh "$LIVE/scripts/block_internet_access.sh" >/dev/null 2>&1 \
  || say "WARNING: could not apply block_internet_access.sh, check manually"

disarm_sentinel
# Their original tree now lives at $PREV as this fork's instant-rollback slot;
# their older pre-existing slot (if any) is intentionally retired, and the swap
# marker is cleared so a stray later restore run correctly no-ops.
rm -rf "$IPTABLES_SNAPSHOT" "$BASELINE_FILE" "$RESTORE_SCRIPT_DEST" "$PREEXISTING_PREV"
rm -f "$SWAP_MARKER"
write_status "install" "success" "migrated to v$STAGED_VERSION; previous fork kept at $PREV (in-app instant rollback)"
say "SUCCESS: migrated to v$STAGED_VERSION. Their original install is kept at $PREV, the app's Settings > Software & updates > Roll back button uses it."
