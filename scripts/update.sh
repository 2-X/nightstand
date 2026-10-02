#!/bin/bash
# Self-updater for this fork. Downloads the newest release of
# LTimothy/nightstand from its tag archive on GitHub and installs it: backup,
# stage, atomic swap, health check, automatic rollback on failure.
#
# Runs on the pod as root, normally via free-sleep-update.service (triggered
# from the app's Settings page). Outbound HTTPS and DNS are allowed only long
# enough to download, then blocked again no matter how the script exits.
#
# Env:
#   FS_UPDATE_FORCE=1   install even if the published version isn't newer
#   NIGHTSTAND_REPO     GitHub repo to pull from (default: LTimothy/nightstand)
#   NIGHTSTAND_BRANCH   branch to read releases.json from (default: main)
#
# Target-version protocol: if the server wrote
# /persistent/free-sleep-data/update-target.json before starting this
# service, that file requests a specific version (and whether a downgrade is
# allowed) instead of the newest release. See the "consume the target-version
# request file" block below.
set -uo pipefail

NIGHTSTAND_REPO="${NIGHTSTAND_REPO:-LTimothy/nightstand}"
NIGHTSTAND_BRANCH="${NIGHTSTAND_BRANCH:-main}"
RELEASES_URL="https://raw.githubusercontent.com/${NIGHTSTAND_REPO}/${NIGHTSTAND_BRANCH}/releases.json"
TAG_ZIP_URL_PREFIX="https://github.com/${NIGHTSTAND_REPO}/archive/refs/tags/v"

# update-target.json protocol: written by POST /api/update before starting
# this service. Consumed once (deleted immediately after reading) so a stale
# file can never redirect a future plain update. FLOOR_VERSION is the first
# release that ships this protocol; versions below it predate the target
# protocol, the rollback service, and possibly current lockfile/node_modules
# compatibility, so the picker can't reach them. 3.0.0 is this stream's first
# release and it ships both, so the floor sits there. Keep it in step with
# CAPABLE_FLOOR in the app's VersionsPage, which gates the same picker.
TARGET_FILE=/persistent/free-sleep-data/update-target.json
FLOOR_VERSION="3.0.0"
SETTINGS_FILE=/persistent/free-sleep-data/lowdb/settingsDB.json

LIVE=/home/dac/free-sleep
PREV=/home/dac/free-sleep-prev
STAGE=/home/dac/free-sleep-staging
FAILED=/home/dac/free-sleep-failed
ZIP=/home/dac/free-sleep-update.zip
BACKUPS=/persistent/free-sleep-backups
DATABASE_BACKUPS=/persistent/free-sleep-database-backups
SQLITE_SAFETY="$(dirname "${BASH_SOURCE[0]}")/sqlite-safety.py"
KEEP_BACKUPS=5
NPM=/home/dac/.volta/bin/npm
NPX=/home/dac/.volta/bin/npx

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# While downloading, allow only HTTPS and name lookups out, above the rest of
# the firewall. Nothing is flushed, so the inbound rules, the reset on the
# firmware's upload port and anything Tailscale added stay in place. IPv6
# stays blocked, with HTTPS refused rather than dropped so clients move to
# IPv4 at once.
WAN_RULES=("-p tcp --dport 443 -j ACCEPT" "-p udp --dport 53 -j ACCEPT" "-p tcp --dport 53 -j ACCEPT")
WAN_RULE6="-p tcp --dport 443 -j REJECT --reject-with tcp-reset"
WAN_OPEN=no
# iptables 1.6.0 added "-w SECONDS"; older builds take a bare -w or no flag.
IPT_W=
for IPT_W in "-w 5" "-w" ""; do
  # shellcheck disable=SC2086
  iptables $IPT_W -S OUTPUT >/dev/null 2>&1 && break
done
# shellcheck disable=SC2086
fw4() { iptables $IPT_W "$@"; }
# shellcheck disable=SC2086
fw6() { ip6tables $IPT_W "$@"; }
# Removes the given rules only while one of them is the first rule in OUTPUT,
# where the window puts them, so the same rule further down (Tailscale's
# HTTPS allow) is left alone. Rules are compared with whitespace and the
# implicit -m tcp/-m udp normalized.
strip_top() {
  local tool=$1 first spec match removed=0
  shift
  while [ "$removed" -lt 10 ]; do
    first=$("$tool" -S OUTPUT 2>/dev/null | awk '$1 == "-A" && $2 == "OUTPUT" { $1 = $2 = ""; $0 = $0; $1 = $1; print; exit }')
    first=${first// -m tcp/}
    first=${first// -m udp/}
    match=
    for spec in "$@"; do
      [ "$first" = "$spec" ] && match=$spec
    done
    [ -n "$match" ] || break
    # shellcheck disable=SC2086
    "$tool" -D OUTPUT $match || break
    removed=$((removed + 1))
  done
  echo "$removed"
}
open_wan() {
  say "Allowing HTTPS and DNS out for the download (temporary)"
  WAN_OPEN=yes
  local rule
  for rule in "${WAN_RULES[@]}"; do
    # shellcheck disable=SC2086
    fw4 -I OUTPUT 1 $rule || say "WARNING: could not allow $rule out"
  done
  # shellcheck disable=SC2086
  fw6 -I OUTPUT 1 $WAN_RULE6 2>/dev/null || true
}
close_wan() {
  [ "$WAN_OPEN" = yes ] || return 0
  say "Closing internet access again"
  strip_top fw4 "${WAN_RULES[@]}" >/dev/null
  strip_top fw6 "$WAN_RULE6" >/dev/null
  sh "$LIVE/scripts/block_internet_access.sh" >/dev/null 2>&1 \
    || sh "$PREV/scripts/block_internet_access.sh" >/dev/null 2>&1 || true
  WAN_OPEN=no
}
# A stalled step must not hold the window open. Busybox builds that only
# take "timeout -t SECS" fail the probe and get the watchdog instead.
run_limited() {
  local seconds=$1 pid watchdog status
  shift
  if timeout 1 true 2>/dev/null; then
    timeout "$seconds" "$@"
    return
  fi
  "$@" &
  pid=$!
  (
    i=0
    while [ "$i" -lt "$seconds" ]; do sleep 1; i=$((i + 1)); done
    kill -TERM "$pid" 2>/dev/null
  ) &
  watchdog=$!
  wait "$pid"
  status=$?
  kill "$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
  return "$status"
}
cleanup() { trap '' HUP INT TERM; close_wan; rm -rf "$STAGE" "$STAGE.unzip" "$STAGE.health" "$STAGE.migrate.log" "$ZIP"; }

fail() { say "FATAL: $*"; exit 1; }

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

# The updater that runs is the one already installed, so a fix to this script
# would otherwise reach a pod one release after it ships. Once the new version
# is downloaded and its dependencies installed, the rest of the update is
# handed to that version's own copy. The line below is how a copy says it
# understands the handoff; an update only hands off to a copy that has it.
# nightstand-update-handoff: 1
HANDOFF_MARKER='# nightstand-update-handoff: 1'
HANDOFF="${NIGHTSTAND_UPDATE_HANDOFF:-}"

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
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$HANDOFF" != 1 ]; then
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

fi

# --- preflight ---------------------------------------------------------------
[ -d "$LIVE" ] || fail "no live install at $LIVE"
CUR_VERSION=$(python3 -c 'import json;print(json.load(open("'"$LIVE"'/server/src/serverInfo.json"))["version"])' 2>/dev/null) \
  || fail "cannot read current version"

# Room for what this run writes, sized from the install it replaces. On /:
# the download and its unpacked tree, and a fresh node_modules when the
# lockfile changed, plus a third of that again for npm's and Prisma's caches
# (68 and 33 MB from empty for 330 MB). A handed-off run has all of that on
# disk already, and a Node that Volta must fetch is checked once staged. On
# /persistent: the code backup (counted unpacked), the database snapshot and
# the settings copy, plus half the database again for migrations, which only
# ever add.
MODULES_MB=$(size_mb "$LIVE/server/node_modules")
TREE_MB=$(( $(size_mb "$LIVE") - MODULES_MB ))
DB_MB=$(size_mb /persistent/free-sleep-data/free-sleep.db /persistent/free-sleep-data/free-sleep.db-wal)
ROOT_NEED=$(( 2 * TREE_MB + MODULES_MB + MODULES_MB / 3 + SPACE_MARGIN_MB ))
[ "$HANDOFF" != 1 ] || ROOT_NEED=$SPACE_MARGIN_MB
PERS_NEED=$(( TREE_MB + DB_MB + DB_MB / 2 + $(size_mb /persistent/free-sleep-data/lowdb) + SPACE_MARGIN_MB ))
ROOT_FREE=$(free_mb /)
PERS_FREE=$(free_mb /persistent)
[ "${ROOT_FREE:-0}" -ge "$ROOT_NEED" ] || fail "low disk on / (${ROOT_FREE:-unknown}M free, ${ROOT_NEED}M needed)"
[ "${PERS_FREE:-0}" -ge "$PERS_NEED" ] \
  || fail "low disk on /persistent (${PERS_FREE:-unknown}M free, ${PERS_NEED}M needed); old snapshots in /persistent/free-sleep-database-backups/ can be removed to make room"

if [ "$HANDOFF" = 1 ]; then
  # Handed off by the previously installed updater, which already consumed the
  # target request, downloaded and staged this version, and installed its
  # dependencies. Pick up from the backup.
  TARGET_VERSION="${NIGHTSTAND_HANDOFF_TARGET:-}"
  IS_DOWNGRADE="${NIGHTSTAND_HANDOFF_IS_DOWNGRADE:-no}"
  unset NIGHTSTAND_UPDATE_HANDOFF NIGHTSTAND_HANDOFF_TARGET NIGHTSTAND_HANDOFF_IS_DOWNGRADE
  [ -d "$STAGE" ] || fail "handed off without a staged tree at $STAGE"
  say "Continuing with the new version's updater (running v$CUR_VERSION)"
else
# Left unindented to the matching fi: the steps below carry inline python that
# has to stay at column 0.


if [ -n "$TARGET_VERSION" ]; then
  FLOOR_OK=$(python3 -c '
import sys
def parts(v): return [int(x) for x in v.split(".")]
print("yes" if parts(sys.argv[1]) >= parts(sys.argv[2]) else "no")' "$TARGET_VERSION" "$FLOOR_VERSION")
  [ "$FLOOR_OK" = yes ] || fail "target v$TARGET_VERSION is below the floor (v$FLOOR_VERSION) the version picker supports"
fi

# --- resolve what to install --------------------------------------------------
if [ -z "$TARGET_VERSION" ]; then
  # Older settings files have no channel; they use the stable default.
  UPDATE_CHANNEL=$(python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as settings_file:
        channel = json.load(settings_file).get("updateChannel") or "stable"
except FileNotFoundError:
    channel = "stable"
if channel not in ("stable", "beta"):
    sys.exit("invalid update channel")
print(channel)' "$SETTINGS_FILE") || fail "could not read update channel from settings"
fi
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
print('known' if target in versions else 'missing')
" 2>/dev/null) || fail "could not parse releases.json"
  [ "$MANIFEST_CHECK" = missing ] && fail "v$TARGET_VERSION is not a known release (checked releases.json)"

  IS_DOWNGRADE=$(python3 -c '
import sys
def parts(v): return [int(x) for x in v.split(".")]
print("yes" if parts(sys.argv[1]) < parts(sys.argv[2]) else "no")' "$TARGET_VERSION" "$CUR_VERSION")
  if [ "$IS_DOWNGRADE" = yes ] && [ "$ALLOW_DOWNGRADE" != yes ]; then
    fail "v$TARGET_VERSION is older than the running v$CUR_VERSION; refusing without allowDowngrade"
  fi

  # Always the tag, never the branch: the branch moves after a release and
  # would install code that no release describes.
  RESOLVED_ZIP_URL="${TAG_ZIP_URL_PREFIX}${TARGET_VERSION}.zip"
  EXPECTED_VERSION="$TARGET_VERSION"
else
  say "Checking GitHub for the newest $UPDATE_CHANNEL release..."
  REMOTE_VERSION=$(curl -fsSL --max-time 20 "$RELEASES_URL" | python3 -c '
import json, re, sys
channel = sys.argv[1]
releases = json.load(sys.stdin)["releases"]
for release in releases:
    if release.get("channel") == "stable" or (channel == "beta" and release.get("channel") == "beta"):
        version = release["version"]
        if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
            sys.exit("invalid release version")
        print(version)
        break
else:
    sys.exit("no release on the selected channel")' "$UPDATE_CHANNEL") \
    || fail "could not resolve a release for $UPDATE_CHANNEL (check releases.json and internet access)"

  NEWER=$(python3 -c '
import sys
cur = [int(x) for x in sys.argv[1].split(".")]
pub = [int(x) for x in sys.argv[2].split(".")]
print("yes" if pub > cur else "no")' "$CUR_VERSION" "$REMOTE_VERSION")

  if [ "$NEWER" = no ] && [ "${FS_UPDATE_FORCE:-0}" != 1 ]; then
    say "Already up to date (published: v$REMOTE_VERSION). Nothing to do."
    exit 0
  fi
  RESOLVED_ZIP_URL="${TAG_ZIP_URL_PREFIX}${REMOTE_VERSION}.zip"
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
fi

# the pod runs prebuilt code; refuse anything missing its build output
[ -f "$STAGE/server/dist/server.js" ] || fail "staged tree is missing server/dist/server.js"
[ -f "$STAGE/server/public/index.html" ] || fail "staged tree is missing server/public/index.html"
STAGED_VERSION=$(python3 -c 'import json;print(json.load(open("'"$STAGE"'/server/src/serverInfo.json"))["version"])') \
  || fail "staged tree has no readable serverInfo.json"
if [ -n "$TARGET_VERSION" ] && [ "$STAGED_VERSION" != "$TARGET_VERSION" ]; then
  fail "staged tree reports v$STAGED_VERSION but v$TARGET_VERSION was requested; refusing a mislabeled release"
fi
if [ -z "$TARGET_VERSION" ] && [ -n "${EXPECTED_VERSION:-}" ] && [ "$STAGED_VERSION" != "$EXPECTED_VERSION" ]; then
  fail "staged tree reports v$STAGED_VERSION but releases.json lists v$EXPECTED_VERSION; refusing a mislabeled release"
fi

# --- dependencies (old server still running) ---------------------------------
LOCK_SAME=no
cmp -s "$LIVE/server/package-lock.json" "$STAGE/server/package-lock.json" && LOCK_SAME=yes
# What / still takes now that the release is staged: a Node that Volta has to
# fetch, and the dependency install with its caches when the lockfile changed.
DEPS_NEED=$(node_fetch_mb "$(node_pin "$STAGE")" "$(node_pin "$LIVE")")
if [ "$HANDOFF" != 1 ] && [ "$LOCK_SAME" = no ]; then
  DEPS_NEED=$(( DEPS_NEED + MODULES_MB + MODULES_MB / 3 ))
fi
DEPS_NEED=$(( DEPS_NEED + SPACE_MARGIN_MB ))
ROOT_FREE=$(free_mb /)
[ "${ROOT_FREE:-0}" -ge "$DEPS_NEED" ] \
  || fail "low disk on / (${ROOT_FREE:-unknown}M free, ${DEPS_NEED}M needed for the new dependencies); live install untouched"
if [ "$HANDOFF" != 1 ]; then
  if [ "$LOCK_SAME" = no ]; then
    say "package-lock.json changed: running npm install in staging"
    run_limited 900 sudo -u dac bash -c "cd '$STAGE/server' && '$NPM' install --no-audit --no-fund" \
      || fail "npm install failed or took over 15 minutes; live install untouched"
  else
    say "package-lock.json unchanged: reusing existing node_modules"
  fi
  # Volta fetches a newly pinned Node the first time npm or npx runs under it,
  # which would otherwise be after the window closes. Fetch it now.
  if [ "$(node_fetch_mb "$(node_pin "$STAGE")" "$(node_pin "$LIVE")")" != 0 ]; then
    say "Fetching Node $(node_pin "$STAGE") for the new version"
    run_limited 600 sudo -u dac bash -c "cd '$STAGE/server' && '$NPM' --version" >/dev/null \
      || fail "could not fetch Node $(node_pin "$STAGE"); live install untouched"
  fi
  close_wan

  # Only to a copy that carries the marker. An older updater would find the
  # target request already consumed and install the latest release instead of
  # the one asked for, so a downgrade would quietly become an upgrade. Without
  # the marker this script finishes the update itself, as before.
  if [ "$IS_DOWNGRADE" != yes ] && grep -Fxq "$HANDOFF_MARKER" "$STAGE/scripts/update.sh" 2>/dev/null; then
    say "Handing the rest of the update to the v$STAGED_VERSION updater"
    # exec replaces this process, so the cleanup trap would never run anyway;
    # cleared explicitly because it deletes the stage the new updater needs.
    trap - EXIT
    export NIGHTSTAND_UPDATE_HANDOFF=1
    export NIGHTSTAND_HANDOFF_TARGET="$TARGET_VERSION"
    export NIGHTSTAND_HANDOFF_IS_DOWNGRADE="$IS_DOWNGRADE"
    exec bash "$STAGE/scripts/update.sh"
  fi
fi

# Preserve archive retention before installing a version that ignores the config.
if [ "$IS_DOWNGRADE" = yes ]; then
  python3 "$(dirname "${BASH_SOURCE[0]}")/prepare-downgrade.py" \
    "$STAGE/scripts/archive-raw.sh" /persistent/free-sleep-data/raw-archive.conf \
    || fail "could not preserve archive retention; downgrade cancelled before the swap"
fi

# --- backup ------------------------------------------------------------------
TS=$(date +%Y%m%d-%H%M%S)
BK="$BACKUPS/${TS}_v${CUR_VERSION}"
say "Backing up code + data to $BK"
mkdir -p "$BK"
tar czf "$BK/code.tar.gz" -C /home/dac --exclude free-sleep/server/node_modules free-sleep || fail "backup failed; aborting, nothing changed"
if [ -f /persistent/free-sleep-data/free-sleep.db ]; then
  DB_BACKUP="$DATABASE_BACKUPS/${TS}_v${CUR_VERSION}_update.db"
  python3 "$SQLITE_SAFETY" backup /persistent/free-sleep-data/free-sleep.db "$DB_BACKUP" \
    || fail "database backup failed; live install untouched"
  say "Database snapshot kept separately at $DB_BACKUP"
fi
cp -r /persistent/free-sleep-data/lowdb "$BK/lowdb" || fail "settings backup failed; live install untouched"
ls -1dt "$BACKUPS"/*/ | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf

# --- atomic swap ---------------------------------------------------------------
say "Installing v$STAGED_VERSION (service stops now)"
# The running server hands back what the next version may not continue. A
# target that has the same route continues it itself.
if [ "$IS_DOWNGRADE" = yes ] && ! grep -qs prepare-to-stop "$STAGE/server/dist/routes/update/update.js"; then
  curl -fsS --max-time 60 -X POST -H 'content-type: application/json' -d '{"reason":"downgrade"}' \
    http://127.0.0.1:3000/api/update/prepare-to-stop >/dev/null \
    || say "WARNING: the server could not prepare to stop; continuing"
fi
STREAM_WAS_ACTIVE=$(systemctl is-active free-sleep-stream 2>/dev/null || true)
systemctl stop free-sleep-stream 2>/dev/null || true
systemctl stop free-sleep
rm -rf "$PREV"
mv "$LIVE" "$PREV" || {
  systemctl start free-sleep
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    systemctl restart free-sleep-stream 2>/dev/null || true
  fi
  fail "swap failed moving live aside"
}
mv "$STAGE" "$LIVE" || {
  mv "$PREV" "$LIVE" || fail "swap failed and previous tree could not be restored; manual recovery required"
  systemctl start free-sleep
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    systemctl restart free-sleep-stream 2>/dev/null || true
  fi
  fail "swap failed; previous version restored"
}
MOVED_MODULES=no
if [ "$LOCK_SAME" = yes ]; then
  mv "$PREV/server/node_modules" "$LIVE/server/node_modules"
  chown -R dac:dac "$LIVE/server/node_modules"
  MOVED_MODULES=yes
fi

# Check the database for pending migrations even when the schema is unchanged.
# migrate status treats a database ahead of the code as up to date, so it never acts on a downgrade.
MIGRATION_FAILED=no
SCHEMA_CHANGED=no
cmp -s "$PREV/server/prisma/schema.prisma" "$LIVE/server/prisma/schema.prisma" || SCHEMA_CHANGED=yes
if [ "$IS_DOWNGRADE" = yes ]; then
  say "Downgrade: skipping prisma migrate; keeping the newer database and generating the target client"
  sudo -u dac bash -c "cd '$LIVE/server' && '$NPX' dotenv -e .env.pod -- npx prisma generate" \
    || MIGRATION_FAILED=yes
elif ! sudo -u dac bash -c "cd '$LIVE/server' && '$NPX' dotenv -e .env.pod -- npx prisma migrate status" >/dev/null 2>&1; then
  say "Database has unapplied migrations: migrate deploy + generate"
  PRISMA_OK=no
  RESOLVED_FAILED=no
  for attempt in 1 2 3; do
    if sudo -u dac bash -c "cd '$LIVE/server' && '$NPX' dotenv -e .env.pod -- npx prisma migrate deploy" 2>&1 | tee "$STAGE.migrate.log"; then
      PRISMA_OK=yes
      break
    fi
    say "prisma migrate attempt $attempt failed"
    if grep -q P3009 "$STAGE.migrate.log"; then
      [ "$RESOLVED_FAILED" = no ] || break
      RECOVERY_HELPER="$LIVE/scripts/sqlite-safety.py"
      [ -f "$RECOVERY_HELPER" ] || RECOVERY_HELPER="$PREV/scripts/sqlite-safety.py"
      FAILED_NAMES=$(python3 "$RECOVERY_HELPER" recoverable-migrations \
        /persistent/free-sleep-data/free-sleep.db "$LIVE/server/prisma/migrations") || {
        say "Failed migration needs manual recovery. Do not reset the database; preserve the backup and inspect the migration log."
        break
      }
      RESOLVED_FAILED=yes
      RESOLVE_OK=yes
      while IFS= read -r migration; do
        sudo -u dac bash -c "cd '$LIVE/server' && '$NPX' dotenv -e .env.pod -- npx prisma migrate resolve --rolled-back '$migration'" || RESOLVE_OK=no
      done <<< "$FAILED_NAMES"
      [ "$RESOLVE_OK" = yes ] || break
    fi
    sleep 5
  done
  [ "$PRISMA_OK" = yes ] &&
    { sudo -u dac bash -c "cd '$LIVE/server' && '$NPX' dotenv -e .env.pod -- npx prisma generate" || PRISMA_OK=no; }
  # Assert the end state rather than trusting the exit code: migrate status
  # fails when anything is still pending, which is the exact condition that
  # nothing downstream of here is able to notice.
  [ "$PRISMA_OK" = yes ] &&
    { sudo -u dac bash -c "cd '$LIVE/server' && '$NPX' dotenv -e .env.pod -- npx prisma migrate status" || PRISMA_OK=no; }
  [ "$PRISMA_OK" = yes ] || MIGRATION_FAILED=yes
elif [ "$SCHEMA_CHANGED" = yes ]; then
  # node_modules may have been carried over from the previous version, with
  # its generated client, so a schema change with nothing to migrate still
  # needs one.
  say "Prisma schema changed with nothing to migrate: generate"
  sudo -u dac bash -c "cd '$LIVE/server' && '$NPX' dotenv -e .env.pod -- npx prisma generate" \
    || MIGRATION_FAILED=yes
fi

# Before the start below, so the limits apply to the processes it starts.
if [ -f "$LIVE/scripts/setup_resource_limits.sh" ]; then
  bash "$LIVE/scripts/setup_resource_limits.sh" \
    || say "WARNING: failed to install service memory limits; the services run unbounded until the next successful update"
fi

if [ "$MIGRATION_FAILED" != yes ]; then
  systemctl start free-sleep
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    systemctl restart free-sleep-stream 2>/dev/null || true
  fi
fi

say "Ensuring RAW-archive retention timer is installed"
if chmod +x "$LIVE/scripts/archive-raw.sh" \
  && cp "$LIVE/scripts/systemd/free-sleep-archive-raw.service" "$LIVE/scripts/systemd/free-sleep-archive-raw.timer" /etc/systemd/system/ \
  && systemctl daemon-reload \
  && systemctl enable --now free-sleep-archive-raw.timer; then
  :
else
  say "WARNING: failed to install RAW-archive retention timer; calibration/analyze jobs may fail on stale data windows"
fi

# --- units and sudoers rules behind the app's controls --------------------------
# Installs that predate a control (or came from another fork) may lack its unit
# or sudoers rule, so the matching button would fail. Idempotent, so every
# update re-runs it.
say "Ensuring the updater, rollback, and revert services and sudoers rules are installed"
if [ -f "$LIVE/scripts/setup_services.sh" ]; then
  bash "$LIVE/scripts/setup_services.sh" "$LIVE" \
    || say "WARNING: some services or sudoers rules could not be installed; the matching controls may not work until the next successful update"
else
  chmod +x "$LIVE"/scripts/update.sh "$LIVE"/scripts/update_service.sh 2>/dev/null || true
fi

# --- health check --------------------------------------------------------------
say "Health check (up to 90s)"
HEALTHY=no
HBODY="$STAGE.health"
for _ in $(seq 1 30); do
  [ "$MIGRATION_FAILED" = yes ] && break
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

# A pod serving HTTP 200 against a half-applied schema looks healthy and is not.
if [ "$MIGRATION_FAILED" = yes ]; then
  say "prisma migrations did not apply; failing the update so it rolls back"
  HEALTHY=no
fi

# The first arming of the hardware watchdog can reset the Pod, so it runs only
# once the update has succeeded. Older trees carry a hand-run copy of the
# script without the trial, which must not run on its own.
arm_watchdog() {
  local script="$LIVE/scripts/setup_watchdog.sh"
  grep -q NIGHTSTAND_WATCHDOG_TRIAL "$script" 2>/dev/null || return 0
  bash "$script" || say "WARNING: the hardware watchdog could not be turned on; see above"
}

if [ "$HEALTHY" = yes ]; then
  for FIREWALL_ATTEMPT in 1 2; do
    sh "$LIVE/scripts/block_internet_access.sh" || say "WARNING: firewall script reported an error; checking rules"
    # Older downgrade targets intentionally restore their historical firewall.
    EXPECT_RESET=yes
    if [ "${IS_DOWNGRADE:-no}" = yes ] &&
      ! grep -q -- '--dport 1337.*--reject-with tcp-reset' "$LIVE/scripts/block_internet_access.sh"; then
      EXPECT_RESET=no
    fi
    if fw4 -C OUTPUT -j DROP; then
      if [ "$EXPECT_RESET" = no ] || fw4 -C OUTPUT -p tcp --dport 1337 -j REJECT --reject-with tcp-reset; then
        say "SUCCESS: pod is serving v$STAGED_VERSION. Previous version kept at $PREV; backup at $BK"
        arm_watchdog
        exit 0
      fi
      if [ "$FIREWALL_ATTEMPT" = 2 ]; then
        say "WARNING: port 1337 reset rule is unavailable; internet access remains blocked by OUTPUT DROP"
        say "SUCCESS: pod is serving v$STAGED_VERSION. Previous version kept at $PREV; backup at $BK"
        arm_watchdog
        exit 0
      fi
    fi
    say "Firewall rules missing after attempt $FIREWALL_ATTEMPT"
  done
  say "New firewall could not be applied; restoring the previous version"
fi

# --- automatic rollback ---------------------------------------------------------
say "Health check FAILED: rolling back to v$CUR_VERSION"
say "Last 60 server log lines from the failed build (for diagnosis):"
tail -n 60 /persistent/free-sleep-data/logs/free-sleep.log 2>/dev/null || say "  (no server log available)"
systemctl stop free-sleep || true
systemctl stop free-sleep-stream 2>/dev/null || true
rm -rf "$FAILED"
mv "$LIVE" "$FAILED" || {
  systemctl start free-sleep
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    systemctl restart free-sleep-stream 2>/dev/null || true
  fi
  fail "could not move failed tree aside; attempted to restart the tree at $LIVE; manual recovery required"
}
mv "$PREV" "$LIVE" || {
  mv "$FAILED" "$LIVE" || fail "could not restore either tree; manual recovery required"
  systemctl start free-sleep
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    systemctl restart free-sleep-stream 2>/dev/null || true
  fi
  fail "could not restore previous tree; attempted to restart the tree at $LIVE; manual recovery required"
}
if [ "$MOVED_MODULES" = yes ]; then
  mv "$FAILED/server/node_modules" "$LIVE/server/node_modules"
fi
systemctl start free-sleep
if [ "$STREAM_WAS_ACTIVE" = active ]; then
  systemctl restart free-sleep-stream 2>/dev/null || true
fi
sleep 8
sh "$LIVE/scripts/block_internet_access.sh" || say "WARNING: restored firewall could not be applied"
if curl -sf --max-time 5 "http://127.0.0.1:3000/api/deviceStatus" >/dev/null; then
  fail "update failed but rollback OK (pod back on v$CUR_VERSION). Failed tree kept at $FAILED; see journalctl -u free-sleep"
else
  fail "update failed AND rollback health check failed. Backup tarball: $BK. Check journalctl -u free-sleep. The bed hardware itself keeps running regardless."
fi
