#!/bin/bash
# Pod-side half of the fork-switch tool.
# Pushed to the target pod by scripts/migrate/switch-to-this-fork.sh and
# started detached (systemd-run, falling back to nohup) so a dropped laptop
# connection changes nothing here.
#
# DESIGN CREED: this tool must be unable to make anyone's night worse. Every
# stage below is either read-only, staged-and-reversible, or covered by an
# automatic restore that fires even if this script itself is killed. The
# firmware and temperature control are never touched (ops/ANTIBRICK.md), the
# worst reachable state is "the free-sleep web layer is down and the
# original install comes back on its own."
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
TAG_ZIP_URL_PREFIX="https://github.com/LTimothy/nightstand/archive/refs/tags/v"

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
cleanup_lock() { rm -f "$LOCK_FILE"; }
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

# ==============================================================================
# Stage: pre-swap (their server is still running and untouched below this line)
# ==============================================================================
write_status "resolve" "in_progress" "resolving latest stable release"

say "Resolving the latest stable release from releases.json..."
RELEASES_JSON=$(curl -fsSL --max-time 20 "$RELEASES_URL") \
  || fail "could not fetch releases.json, check the pod's WAN access"
TARGET_VERSION=$(printf '%s' "$RELEASES_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
stable = [r['version'] for r in data['releases'] if r['channel'] == 'stable']
print(stable[0] if stable else '')
") || fail "could not parse releases.json"
[ -n "$TARGET_VERSION" ] || fail "no stable release found in releases.json"
say "Target: v$TARGET_VERSION (latest stable)"
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

ROOT_FREE=$(df -m / | awk 'NR==2{print $4}')
PERS_FREE=$(df -m /persistent | awk 'NR==2{print $4}')
[ "$ROOT_FREE" -gt 2000 ] || fail "low disk on / (${ROOT_FREE}M free), aborting before touching anything"
[ "$PERS_FREE" -gt 2000 ] || fail "low disk on /persistent (${PERS_FREE}M free), aborting before touching anything"

say "Downloading v$TARGET_VERSION (stable tag archive, not main HEAD)..."
curl -fL --max-time 300 -o "$ZIP" "${TAG_ZIP_URL_PREFIX}${TARGET_VERSION}.zip" \
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

say "Staging systemd units and sudoers rules (installed atomically after the swap)..."
mkdir -p /home/dac/free-sleep-migrate-units
cp "$STAGE/scripts/systemd/free-sleep-archive-raw.service" \
   "$STAGE/scripts/systemd/free-sleep-archive-raw.timer" \
   "$STAGE/scripts/systemd/free-sleep-rollback.service" \
   /home/dac/free-sleep-migrate-units/ 2>/dev/null || true

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
ExecStart=/bin/bash $RESTORE_SCRIPT_DEST
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
  bash "$RESTORE_SCRIPT_DEST"
  disarm_sentinel
  write_status "install" "restored" "$1"
}

# ==============================================================================
# Swap
# ==============================================================================
write_status "swap" "in_progress" "stopping original service"
say "Stopping their service (their tree is untouched up to this point)"
systemctl stop free-sleep >/dev/null 2>&1 || true
systemctl stop free-sleep-stream >/dev/null 2>&1 || true

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

say "Installing our systemd units..."
cp /home/dac/free-sleep-migrate-units/*.service /home/dac/free-sleep-migrate-units/*.timer /etc/systemd/system/ 2>/dev/null || true
systemctl daemon-reload

say "Running prisma migrate deploy (additive by standing rule)..."
sudo -u dac bash -c "cd '$LIVE/server' && '$NPX' dotenv -e .env.pod -- npx prisma migrate deploy && '$NPX' dotenv -e .env.pod -- npx prisma generate" \
  || say "WARNING: prisma step failed; health check will decide"

systemctl start free-sleep || { restore_and_report "our service failed to start"; exit 1; }
# The swap above stopped free-sleep-stream (its ExecStart lives inside the tree
# we just moved). It's a continuously-running biometrics/presence streamer
# (enabled, Restart=always) that nothing else brings back, so start it here or
# live biometrics stay dark until the next reboot. Best-effort: a pod without a
# separate stream service (older layouts) simply has nothing to start.
systemctl start free-sleep-stream >/dev/null 2>&1 || true
systemctl enable --now free-sleep-archive-raw.timer >/dev/null 2>&1 || true
# NB: free-sleep-rollback.service is a STATIC, on-demand oneshot, the app starts
# it only when the user clicks "Roll back", and it swaps $LIVE <-> $PREV. Do NOT
# `enable --now` it here: --now would EXECUTE an instant rollback right now,
# transposing the freshly-installed tree back out with the original fork before
# the health check even runs (the check would then see the OLD version, "fail",
# and the restore would inherit an already-swapped pair). Installing the unit
# file above (cp + daemon-reload) is all it needs to be startable on demand.

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
say "Health check passed on v$STAGED_VERSION. Applying this fork's WAN policy..."
sh "$LIVE/scripts/block_internet_access.sh" >/dev/null 2>&1 \
  || say "WARNING: could not apply block_internet_access.sh, check manually"

disarm_sentinel
# Their original tree now lives at $PREV as this fork's instant-rollback slot;
# their older pre-existing slot (if any) is intentionally retired, and the swap
# marker is cleared so a stray later restore run correctly no-ops.
rm -rf /home/dac/free-sleep-migrate-units "$IPTABLES_SNAPSHOT" "$BASELINE_FILE" "$RESTORE_SCRIPT_DEST" "$PREEXISTING_PREV"
rm -f "$SWAP_MARKER"
write_status "install" "success" "migrated to v$STAGED_VERSION; previous fork kept at $PREV (in-app instant rollback)"
say "SUCCESS: migrated to v$STAGED_VERSION. Their original install is kept at $PREV, the app's Settings > Software & updates > Roll back button uses it."
