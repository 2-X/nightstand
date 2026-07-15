#!/bin/bash
# Laptop-side half of the fork-switch tool. For someone running
# throwaway31265 (upstream), jmew, or another fork
# on their own pod, who wants to move to LTimothy/nightstand.
#
# DESIGN CREED: this tool must be unable to make anyone's night worse. Every
# stage is either read-only, staged-and-reversible, or covered by an
# automatic restore that fires even if the tool itself is killed. The
# firmware and temperature control are never touched (ops/ANTIBRICK.md);
# the worst reachable state is "the free-sleep web layer is down and your
# original install comes back automatically."
#
# Download this script, read it if you like, then run it, it's meant to be
# safe to run point-blank: nothing is modified before an explicit typed
# confirmation. Run with --dry-run first to see the full report without
# changing anything.
#
# Usage:
#   switch-to-this-fork.sh [--ip <addr>] [--dry-run] [--assume-model podN]
#                           [--migrate-anyway]
#   switch-to-this-fork.sh --restore <backup-tarball> [--ip <addr>]
#   switch-to-this-fork.sh --help
#
# Pod-generation and bed-in-use warnings always require a typed
# acknowledgment interactively, there is no flag to skip them.
#
# Requires only curl/ssh/scp/tar on the laptop (macOS + Linux). sshpass is
# used if present but never required.
set -uo pipefail

# --- args ----------------------------------------------------------------
IP=""
DRY_RUN=no
ASSUME_MODEL=""
MIGRATE_ANYWAY=no
RESTORE_TARBALL=""
RELEASES_URL="https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json"

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \?//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --ip) IP="$2"; shift 2 ;;
    --dry-run) DRY_RUN=yes; shift ;;
    --assume-model) ASSUME_MODEL="$2"; shift 2 ;;
    --migrate-anyway) MIGRATE_ANYWAY=yes; shift ;;
    --restore) RESTORE_TARBALL="$2"; shift 2 ;;
    --help|-h) usage ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { echo "" >&2; echo "ABORTED: $*" >&2; echo "Nothing was changed." >&2; exit 1; }

SSH_USER=root
SSH_PASS=""
SSH_PORT=""
POD_IP=""

# Wraps ssh/scp so callers don't repeat -p/-o/sshpass plumbing. Password is
# read once (stage 2) and held only in memory for this process, never
# stored, never echoed, never logged.
ssh_cmd() {
  local port="$1"; shift
  if command -v sshpass >/dev/null 2>&1 && [ -n "$SSH_PASS" ]; then
    sshpass -p "$SSH_PASS" ssh -p "$port" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 "$SSH_USER@$POD_IP" "$@"
  else
    ssh -p "$port" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 "$SSH_USER@$POD_IP" "$@"
  fi
}

scp_to_pod() {
  local port="$1" src="$2" dest="$3"
  if command -v sshpass >/dev/null 2>&1 && [ -n "$SSH_PASS" ]; then
    sshpass -p "$SSH_PASS" scp -P "$port" -o StrictHostKeyChecking=accept-new -r "$src" "$SSH_USER@$POD_IP:$dest"
  else
    scp -P "$port" -o StrictHostKeyChecking=accept-new -r "$src" "$SSH_USER@$POD_IP:$dest"
  fi
}

# The pod is a single-core ARM box guarded by a 31s hardware watchdog
# (mtk-wdt). Serving a multi-tens-of-MB backup over encrypted scp at full tilt
# can saturate the core long enough to starve the watchdog-petter and force a
# reboot mid-pull. Cap the transfer rate so scp always leaves the core headroom
# (-l is in Kbit/s; 16000 ≈ 2 MB/s, so even a 60MB backup finishes in ~30s at
# low CPU) and disable scp's own compression, the tarball is already gzipped,
# so it would only burn CPU for nothing.
POD_PULL_LIMIT_KBIT=16000
scp_from_pod() {
  local port="$1" src="$2" dest="$3"
  if command -v sshpass >/dev/null 2>&1 && [ -n "$SSH_PASS" ]; then
    sshpass -p "$SSH_PASS" scp -P "$port" -l "$POD_PULL_LIMIT_KBIT" -o Compression=no -o StrictHostKeyChecking=accept-new "$SSH_USER@$POD_IP:$src" "$dest"
  else
    scp -P "$port" -l "$POD_PULL_LIMIT_KBIT" -o Compression=no -o StrictHostKeyChecking=accept-new "$SSH_USER@$POD_IP:$src" "$dest"
  fi
}

# ==============================================================================
# --restore mode: pushes a laptop-side backup tarball back and re-swaps.
# Works even against a pod whose free-sleep layer is entirely dead, it only
# needs SSH. A fallback for when the in-app rollback button can't be used.
# ==============================================================================
if [ -n "$RESTORE_TARBALL" ]; then
  [ -f "$RESTORE_TARBALL" ] || fail "backup tarball not found: $RESTORE_TARBALL"
  [ -n "$IP" ] || fail "--restore requires --ip <addr> (the pod may not be resolvable by hostname if its layer is down)"
  POD_IP="$IP"
  echo "This will push $RESTORE_TARBALL to $POD_IP and restore it over whatever is at /home/dac/free-sleep."
  read -r -p "Type 'restore' to proceed: " CONFIRM
  [ "$CONFIRM" = "restore" ] || fail "confirmation not given"
  read -r -s -p "SSH password for root@$POD_IP: " SSH_PASS; echo
  for port in 8822 22; do
    if ssh_cmd "$port" "true" 2>/dev/null; then SSH_PORT="$port"; break; fi
  done
  [ -n "$SSH_PORT" ] || fail "could not reach $POD_IP over SSH on port 8822 or 22"
  say "Pushing backup tarball..."
  scp_to_pod "$SSH_PORT" "$RESTORE_TARBALL" "/home/dac/free-sleep-restore.tar.gz"
  say "Extracting and restarting..."
  ssh_cmd "$SSH_PORT" "
    systemctl stop free-sleep 2>/dev/null || true
    rm -rf /home/dac/free-sleep-restore-tmp && mkdir -p /home/dac/free-sleep-restore-tmp
    tar xzf /home/dac/free-sleep-restore.tar.gz -C /home/dac/free-sleep-restore-tmp
    rm -rf /home/dac/free-sleep
    mv /home/dac/free-sleep-restore-tmp/free-sleep /home/dac/free-sleep
    rm -rf /home/dac/free-sleep-restore-tmp /home/dac/free-sleep-restore.tar.gz
    chown -R dac:dac /home/dac/free-sleep
    systemctl start free-sleep 2>/dev/null || echo 'WARNING: could not start free-sleep.service (may need a different service name)'
  " || fail "restore failed over SSH, the tarball is still at $RESTORE_TARBALL, nothing else was touched"
  say "Restore complete. Check http://$POD_IP:3000/ once it's back up."
  exit 0
fi

# ==============================================================================
# Stage 1, Locate (read-only)
# ==============================================================================
say "Stage 1: locating the pod"
if [ -n "$IP" ]; then
  POD_IP="$IP"
elif curl -sf --max-time 3 "http://eight-pod.local:3000/api/deviceStatus" >/dev/null 2>&1; then
  POD_IP="eight-pod.local"
elif curl -sf --max-time 3 "http://eight-pod:3000/api/deviceStatus" >/dev/null 2>&1; then
  POD_IP="eight-pod"
else
  read -r -p "Couldn't find a pod at eight-pod.local. Scan the local /24 subnet for one? [y/N] " SCAN_OK
  if [ "$SCAN_OK" != "y" ] && [ "$SCAN_OK" != "Y" ]; then
    fail "no pod found. Re-run with --ip <address> if you know it."
  fi
  BASE=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' | head -n1)
  MY_IP=$(ipconfig getifaddr "$BASE" 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
  [ -n "$MY_IP" ] || fail "could not determine the local subnet to scan"
  SUBNET=$(echo "$MY_IP" | cut -d. -f1-3)
  say "Scanning ${SUBNET}.0/24 on port 3000 (this takes a few seconds)..."
  CANDIDATES=()
  for i in $(seq 1 254); do
    (
      exec 3<>"/dev/tcp/${SUBNET}.${i}/3000" 2>/dev/null && echo "${SUBNET}.${i}" >> /tmp/free-sleep-scan-hits
    ) 2>/dev/null &
  done
  wait
  if [ -f /tmp/free-sleep-scan-hits ]; then
    while read -r hit; do
      if curl -sf --max-time 2 "http://$hit:3000/api/deviceStatus" | grep -q "currentTemperatureF"; then
        CANDIDATES+=("$hit")
      fi
    done < /tmp/free-sleep-scan-hits
    rm -f /tmp/free-sleep-scan-hits
  fi
  case "${#CANDIDATES[@]}" in
    0) fail "subnet scan found no free-sleep pod" ;;
    1) POD_IP="${CANDIDATES[0]}" ;;
    *)
      echo "Multiple candidates found:"
      select choice in "${CANDIDATES[@]}"; do POD_IP="$choice"; break; done
      ;;
  esac
fi
say "Using pod at $POD_IP"

# ==============================================================================
# Stage 2, Identify (read-only)
# ==============================================================================
say "Stage 2: identifying the pod's current install"

DEVICE_STATUS=$(curl -sf --max-time 5 "http://$POD_IP:3000/api/deviceStatus") \
  || fail "could not reach http://$POD_IP:3000/api/deviceStatus"
RUNNING_VERSION=$(printf '%s' "$DEVICE_STATUS" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("freeSleep",{}).get("version","unknown"))' 2>/dev/null || echo unknown)
RUNNING_BRANCH=$(printf '%s' "$DEVICE_STATUS" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("freeSleep",{}).get("branch","unknown"))' 2>/dev/null || echo unknown)

# No fork serves an explicit "which fork am I" field over HTTP today:
# serverInfo.json (which has one) is fetched by the BROWSER directly from
# GitHub, never by the pod's own API (see app/src/api/serverInfo.ts). Over
# HTTP the best signal is the version stream (this fork starts at 3.0.0,
# upstream/jmew are on 2.x), but any sibling fork that shares the 3.x stream
# looks identical here. So the version is only a HINT, the authoritative
# "are you already on this fork" decision is deferred to Stage 2b, made from
# the repo the pod's own on-disk updater points at, which names the fork
# exactly.
MAJOR_VERSION=$(printf '%s' "$RUNNING_VERSION" | cut -d. -f1)
if [ "$RUNNING_BRANCH" = "main" ] && [ "${MAJOR_VERSION:-0}" -ge 3 ] 2>/dev/null; then
  say "v$RUNNING_VERSION shares this fork's 3.x version stream, will confirm the exact repo over SSH before treating it as a migration."
else
  say "Detected version v$RUNNING_VERSION on branch '$RUNNING_BRANCH'."
fi

read -r -p "SSH password for root@$POD_IP (tried on port 8822 then 22): " -s SSH_PASS
echo
for port in 8822 22; do
  if ssh_cmd "$port" "true" 2>/dev/null; then SSH_PORT="$port"; break; fi
done
[ -n "$SSH_PORT" ] || fail "could not SSH into $POD_IP as root on port 8822 or 22"
say "SSH OK on port $SSH_PORT"

REMOTE_REPO="/home/dac/free-sleep"
if ! ssh_cmd "$SSH_PORT" "[ -d '$REMOTE_REPO' ] && [ -f '$REMOTE_REPO/server/package.json' ]"; then
  fail "no recognizable free-sleep install at $REMOTE_REPO on that pod. This tool only migrates installs it recognizes, try a fresh scripts/install.sh instead."
fi
if ! ssh_cmd "$SSH_PORT" "systemctl list-unit-files | grep -q '^free-sleep.service'"; then
  fail "no free-sleep.service known to systemd on that pod. Too old or too different to migrate automatically."
fi

# ==============================================================================
# Stage 2b, Confirm this is really another fork (authoritative, on-disk)
# ==============================================================================
# The pod's own updater names the repo it pulls from, and that is the one
# unambiguous "which fork" signal there is: this fork's installs point their
# updater at LTimothy/nightstand; every other fork points elsewhere. Refuse
# only when it is demonstrably THIS repo, never on the version-stream hint
# alone, so a sibling fork that shares the 3.x stream can still migrate.
THIS_FORK_REPO="LTimothy/nightstand"
ONDISK_UPDATER=$(ssh_cmd "$SSH_PORT" "cat '$REMOTE_REPO/scripts/update.sh' 2>/dev/null; cat '$REMOTE_REPO/scripts/install.sh' 2>/dev/null" || true)
ONDISK_FORK_REPO=$(printf '%s' "$ONDISK_UPDATER" | grep -oE 'github(usercontent)?\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+' | head -n1 | sed -E 's#.*\.com/##')
if [ "$ONDISK_FORK_REPO" = "$THIS_FORK_REPO" ]; then
  fail "this pod's own updater already points at $THIS_FORK_REPO, it is already on this fork. Use the in-app updater (Settings > Software & updates) instead; this tool is only for migrating FROM another fork."
fi
if [ -n "$ONDISK_FORK_REPO" ]; then
  say "The pod's updater points at '$ONDISK_FORK_REPO', treating this as a migration to $THIS_FORK_REPO."
else
  say "Could not read the pod's updater repo; proceeding as a migration to $THIS_FORK_REPO (running v$RUNNING_VERSION)."
fi

# Disk space, both sides.
REMOTE_ROOT_FREE=$(ssh_cmd "$SSH_PORT" "df -m / | awk 'NR==2{print \$4}'")
REMOTE_PERS_FREE=$(ssh_cmd "$SSH_PORT" "df -m /persistent | awk 'NR==2{print \$4}'" 2>/dev/null || echo 0)
[ "${REMOTE_ROOT_FREE:-0}" -gt 2000 ] 2>/dev/null || fail "low disk on the pod's / (${REMOTE_ROOT_FREE}M free)"
[ "${REMOTE_PERS_FREE:-0}" -gt 2000 ] 2>/dev/null || fail "low disk on the pod's /persistent (${REMOTE_PERS_FREE}M free)"
LAPTOP_FREE_KB=$(df -Pk . | awk 'NR==2{print $4}')
[ "${LAPTOP_FREE_KB:-0}" -gt 2097152 ] 2>/dev/null || fail "low free disk here on the laptop (need >2GB for the backup copy)"

# Pod generation. The hub reports it directly in deviceStatus (coverVersion),
# which every fork exposes and which comes straight from the hardware, a far
# more reliable signal than guessing from on-disk RAW files. The RAW files are
# named <hex>.RAW; "capSense2"/"capSense" are CBOR field names INSIDE them, not
# filenames, so the old ls-glob matched nothing on any Pod and forced everyone
# through --assume-model. Keep that glob only as a fallback for a fork whose
# deviceStatus somehow omits coverVersion.
say "Detecting pod generation..."
COVER_VERSION=$(printf '%s' "$DEVICE_STATUS" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("coverVersion",""))' 2>/dev/null || echo "")
case "$COVER_VERSION" in
  *5*) DETECTED_MODEL="pod5" ;;
  *4*|*3*) DETECTED_MODEL="pod3or4" ;;
  *2*) DETECTED_MODEL="pod2" ;;
  *1*) DETECTED_MODEL="pod1" ;;
  *)
    RAW_SIGNAL=$(ssh_cmd "$SSH_PORT" "ls /persistent/*/capSense2* /persistent/*/bedTemp2* 2>/dev/null | head -n1")
    LEGACY_SIGNAL=$(ssh_cmd "$SSH_PORT" "ls /persistent/*/capSense[^2]* /persistent/*/bedTemp[^2]* 2>/dev/null | head -n1")
    if [ -n "$RAW_SIGNAL" ] && [ -z "$LEGACY_SIGNAL" ]; then
      DETECTED_MODEL="pod5"
    elif [ -z "$RAW_SIGNAL" ] && [ -n "$LEGACY_SIGNAL" ]; then
      DETECTED_MODEL="pod3or4"
    else
      DETECTED_MODEL="unknown"
    fi
    ;;
esac
IDENTIFICATION_FAILED=no
if [ "$DETECTED_MODEL" = "unknown" ] || [ -n "$ASSUME_MODEL" ]; then
  IDENTIFICATION_FAILED=yes
fi
if [ -n "$ASSUME_MODEL" ]; then
  DETECTED_MODEL="$ASSUME_MODEL"
fi
say "Detected generation: $DETECTED_MODEL$([ "$IDENTIFICATION_FAILED" = yes ] && echo ' (assumed, identification failed or was overridden)')"

# Baseline health snapshot (compared again after the swap).
BASELINE_STATUS="$DEVICE_STATUS"
BASELINE_ACTIVE=$(ssh_cmd "$SSH_PORT" "systemctl is-active free-sleep" 2>/dev/null || echo "unknown")
if [ "$BASELINE_ACTIVE" != "active" ] && [ "$MIGRATE_ANYWAY" != yes ]; then
  fail "the pod's current install isn't healthy (free-sleep.service is '$BASELINE_ACTIVE'), we can't promise to return you to a working state that doesn't exist. Re-run with --migrate-anyway to proceed eyes-open."
fi

# Bed-in-use check.
LEFT_ON=$(printf '%s' "$DEVICE_STATUS" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("left",{}).get("isOn",False))' 2>/dev/null)
RIGHT_ON=$(printf '%s' "$DEVICE_STATUS" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("right",{}).get("isOn",False))' 2>/dev/null)
if [ "$LEFT_ON" = "True" ] || [ "$RIGHT_ON" = "True" ]; then
  echo "One or both sides currently show as powered on, someone may be in bed."
  read -r -p "Type 'bed-in-use-ok' to proceed anyway: " BED_ACK
  [ "$BED_ACK" = "bed-in-use-ok" ] || fail "bed-in-use acknowledgment not given"
fi

# Clock skew.
POD_TIME=$(ssh_cmd "$SSH_PORT" "date -u +%s" 2>/dev/null || echo 0)
LAPTOP_TIME=$(date -u +%s)
SKEW=$(( POD_TIME > LAPTOP_TIME ? POD_TIME - LAPTOP_TIME : LAPTOP_TIME - POD_TIME ))
if [ "$SKEW" -gt 120 ]; then
  echo "Pod clock is off by ${SKEW}s from this laptop, this can break TLS to GitHub mid-download."
  read -r -p "Set the pod's clock from this laptop's now? [y/N] " FIX_CLOCK
  if [ "$FIX_CLOCK" = "y" ] || [ "$FIX_CLOCK" = "Y" ]; then
    ssh_cmd "$SSH_PORT" "date -u -s @$LAPTOP_TIME" >/dev/null 2>&1 || say "WARNING: could not set the pod's clock"
  fi
fi

# WAN state + iptables snapshot (every abort path restores exactly this).
WAN_OK=$(ssh_cmd "$SSH_PORT" "curl -sf --max-time 5 https://github.com >/dev/null 2>&1 && echo yes || echo no")
say "Pod WAN reachability right now: $WAN_OK"
IPTABLES_SNAPSHOT_LOCAL=$(mktemp)
ssh_cmd "$SSH_PORT" "iptables-save 2>/dev/null" > "$IPTABLES_SNAPSHOT_LOCAL" || true

# --- Pod generation gate matrix -------------------------------------------
if [ "$DETECTED_MODEL" = "unknown" ] && [ -z "$ASSUME_MODEL" ]; then
  fail "could not determine the pod generation from independent signals (they conflicted or were absent). Re-run with --assume-model podN if you're sure, or file an issue."
fi
if [ "$IDENTIFICATION_FAILED" = yes ]; then
  echo "Identification failed or was overridden, proceeding on the assumption this is a $DETECTED_MODEL."
fi
case "$DETECTED_MODEL" in
  pod5)
    if [ "$IDENTIFICATION_FAILED" = yes ]; then
      read -r -p "Type 'pod4-ok' to proceed on this assumption anyway: " ACK
      [ "$ACK" = "pod4-ok" ] || fail "model acknowledgment not given"
    fi
    ;;
  pod3or4)
    echo "This looks like a Pod 3 or 4. This fork is developed and tested on Pod 5 only."
    echo "Upstream supported Pod 3/4, but biometrics RAW formats differ (legacy type names),"
    echo "so sleep tracking may be degraded or broken. Temperature control and scheduling should work."
    read -r -p "Type 'pod4-ok' to proceed anyway: " ACK
    [ "$ACK" = "pod4-ok" ] || fail "pod3/4 acknowledgment not given"
    ;;
  pod1|pod2)
    fail "Pod 1/2 have no free-sleep lineage, different platform, no dac.sock. There is nothing to migrate to. See the supported-hardware docs."
    ;;
  *)
    fail "unrecognized --assume-model value '$DETECTED_MODEL' (expected pod1, pod2, pod3or4, or pod5)"
    ;;
esac

DETECTED_MODEL_NOTE="Pod 5: fully supported."
[ "$DETECTED_MODEL" = "pod3or4" ] && DETECTED_MODEL_NOTE="Pod 3/4: acknowledged above, sleep tracking may be degraded, temperature control and scheduling should work."

# ==============================================================================
# Stage 3, Report and consent (still read-only)
# ==============================================================================
STABLE_VERSION=$(curl -fsSL --max-time 20 "$RELEASES_URL" | python3 -c "
import json, sys
data = json.load(sys.stdin)
stable = [r['version'] for r in data['releases'] if r['channel'] == 'stable']
print(stable[0] if stable else '')
" 2>/dev/null)
[ -n "$STABLE_VERSION" ] || fail "could not resolve the latest stable release from releases.json"

cat <<REPORT

============================== Migration report ==============================
Found:
  Pod:              $POD_IP (generation: $DETECTED_MODEL)
  Current version:   v$RUNNING_VERSION on branch '$RUNNING_BRANCH' (fork identity is a best-effort guess, see above)
  Disk headroom:      pod /=${REMOTE_ROOT_FREE}M, /persistent=${REMOTE_PERS_FREE}M
  WAN reachable now:  $WAN_OK

What will happen:
  1. Full backup: a tarball of the pod's code + data, kept on the pod AND
     pulled to this laptop, both integrity-verified before anything else
     happens.
  2. Install LTimothy/nightstand v$STABLE_VERSION (the current soaked stable
     release, not main HEAD).
  3. Your old install is preserved at /home/dac/free-sleep-prev, this
     becomes the in-app instant-rollback slot afterward.

What changes about behavior:
  - This fork firewalls the pod's WAN by default (updates open it briefly).
  - Your sleep data and schedules are kept, both databases carry over. A
    data-compatibility dry run runs before anything is touched and aborts
    pre-swap if it finds anything that can't be carried over safely.
  - ${DETECTED_MODEL_NOTE:-}

How to get back, in order of preference:
  - The in-app "Roll back" button (Settings > Software & updates) once
    migrated, instant, no download.
  - The laptop-side backup tarball this tool is about to create, restorable
    with: switch-to-this-fork.sh --restore <tarball> --ip $POD_IP
================================================================================

REPORT

if [ "$DRY_RUN" = yes ]; then
  say "--dry-run: stopping here. Nothing was changed."
  exit 0
fi

read -r -p "Type 'switch' to proceed: " CONFIRM
[ "$CONFIRM" = "switch" ] || fail "confirmation not given"

# ==============================================================================
# Stage 4, Backup before anything
# ==============================================================================
say "Stage 4: backing up the pod (code + data) before touching anything"
TS=$(date +%Y%m%d-%H%M%S)
REMOTE_BACKUP_DIR="/persistent/free-sleep-backups"
REMOTE_BACKUP_TARBALL="$REMOTE_BACKUP_DIR/migrate-${TS}.tar.gz"
LOCAL_BACKUP_TARBALL="./free-sleep-migrate-backup-${TS}.tar.gz"

ssh_cmd "$SSH_PORT" "
  set -e
  mkdir -p '$REMOTE_BACKUP_DIR'
  STAGE=/home/dac/free-sleep-backup-staging
  rm -rf \"\$STAGE\" && mkdir -p \"\$STAGE/free-sleep\"
  cp -a /home/dac/free-sleep/. \"\$STAGE/free-sleep/\" 2>/dev/null || true
  rm -rf \"\$STAGE/free-sleep/server/node_modules\"
  mkdir -p \"\$STAGE/free-sleep-data\"
  if [ -f /persistent/free-sleep-data/free-sleep.db ]; then
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 /persistent/free-sleep-data/free-sleep.db '.backup '\''\$STAGE/free-sleep-data/free-sleep.db'\''' && echo 'used sqlite3 .backup'
    else
      cp /persistent/free-sleep-data/free-sleep.db \"\$STAGE/free-sleep-data/\" && echo 'used plain copy (sqlite3 not present)'
    fi
  fi
  cp -r /persistent/free-sleep-data/lowdb \"\$STAGE/free-sleep-data/\" 2>/dev/null || true
  tar czf '$REMOTE_BACKUP_TARBALL' -C \"\$STAGE\" .
  rm -rf \"\$STAGE\"
  tar tzf '$REMOTE_BACKUP_TARBALL' >/dev/null
" || fail "backup on the pod failed; nothing else was touched"

say "Pulling the backup to this laptop..."
scp_from_pod "$SSH_PORT" "$REMOTE_BACKUP_TARBALL" "$LOCAL_BACKUP_TARBALL" \
  || fail "could not pull the backup to this laptop; nothing else was touched"
tar tzf "$LOCAL_BACKUP_TARBALL" >/dev/null || fail "local backup copy failed integrity check; nothing else was touched"
REMOTE_SIZE=$(ssh_cmd "$SSH_PORT" "stat -c%s '$REMOTE_BACKUP_TARBALL' 2>/dev/null || stat -f%z '$REMOTE_BACKUP_TARBALL'")
LOCAL_SIZE=$(stat -f%z "$LOCAL_BACKUP_TARBALL" 2>/dev/null || stat -c%s "$LOCAL_BACKUP_TARBALL")
[ "$REMOTE_SIZE" = "$LOCAL_SIZE" ] || fail "backup size mismatch between pod ($REMOTE_SIZE) and laptop ($LOCAL_SIZE) copies; nothing else was touched"
say "Backup verified in both places. Pod: $REMOTE_BACKUP_TARBALL, Laptop: $LOCAL_BACKUP_TARBALL"

# Baseline temperatures, written for pod-installer.sh's post-swap comparison.
BASELINE_JSON=$(printf '%s' "$BASELINE_STATUS" | python3 -c '
import json, sys
d = json.load(sys.stdin)
out = {}
for side in ("left", "right"):
    t = d.get(side, {}).get("currentTemperatureF")
    if isinstance(t, (int, float)):
        out[side] = t
print(json.dumps(out))
' 2>/dev/null || echo "{}")
printf '%s' "$BASELINE_JSON" | ssh_cmd "$SSH_PORT" "cat > /home/dac/free-sleep-migrate-baseline.json"

# ==============================================================================
# Stage 5, push pod-installer.sh, start it detached, poll status
# ==============================================================================
say "Stage 5: pushing the installer and starting it (detached, safe if this laptop disconnects)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ssh_cmd "$SSH_PORT" "mkdir -p /home/dac/migrate"
scp_to_pod "$SSH_PORT" "$SCRIPT_DIR/pod-installer.sh" "/home/dac/migrate/pod-installer.sh"
scp_to_pod "$SSH_PORT" "$SCRIPT_DIR/restore-original-fork.sh" "/home/dac/migrate/restore-original-fork.sh"
ssh_cmd "$SSH_PORT" "chmod +x /home/dac/migrate/pod-installer.sh /home/dac/migrate/restore-original-fork.sh"
# Push the Stage 2 (pre-consent) iptables snapshot rather than letting
# pod-installer.sh take a fresh one later, every abort path must restore
# the state the pod was actually in when the user typed "switch", not
# whatever it drifts to during Stage 4/5.
scp_to_pod "$SSH_PORT" "$IPTABLES_SNAPSHOT_LOCAL" "/home/dac/free-sleep-migrate-iptables-snapshot.rules"

ssh_cmd "$SSH_PORT" "
  if command -v systemd-run >/dev/null 2>&1; then
    systemd-run --unit=free-sleep-migrate --collect bash /home/dac/migrate/pod-installer.sh
  else
    nohup bash /home/dac/migrate/pod-installer.sh >/home/dac/migrate/installer.out 2>&1 & disown
  fi
" || fail "could not start the installer on the pod"

say "Installer started. Polling status (safe to close this laptop, it'll keep running)..."
STATUS_FILE_REMOTE="/persistent/free-sleep-data/migration-status.json"
ATTEMPTS=0
while [ "$ATTEMPTS" -lt 200 ]; do
  sleep 6
  ATTEMPTS=$((ATTEMPTS + 1))
  STATUS_JSON=$(ssh_cmd "$SSH_PORT" "cat '$STATUS_FILE_REMOTE' 2>/dev/null") || { say "  (reconnecting...)"; continue; }
  [ -n "$STATUS_JSON" ] || continue
  OUTCOME=$(printf '%s' "$STATUS_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("outcome",""))' 2>/dev/null)
  STAGE_NAME=$(printf '%s' "$STATUS_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("stage",""))' 2>/dev/null)
  say "  [$STAGE_NAME] $OUTCOME"
  case "$OUTCOME" in
    success)
      cat <<AFTERCARE

============================== Migration complete =============================
Pod:              http://$POD_IP:3000/
Backup (pod):      $REMOTE_BACKUP_TARBALL
Backup (laptop):    $LOCAL_BACKUP_TARBALL
Migration log:      /persistent/free-sleep-data/logs/migration-*.log (on the pod)
Instant rollback to your old fork now lives in the app: Settings > Software &
updates > Roll back.

Keep the laptop backup tarball for at least a few nights.
=================================================================================
AFTERCARE
      exit 0
      ;;
    restored|failed|refused)
      fail "migration did not succeed (outcome: $OUTCOME). Your original install has been restored automatically. Details: $(printf '%s' "$STATUS_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("message",""))' 2>/dev/null)"
      ;;
  esac
done
fail "gave up waiting for the migration to report a final outcome after 20 minutes. The dead-man sentinel will restore your original fork on its own if the installer died; check http://$POD_IP:3000/ directly."
