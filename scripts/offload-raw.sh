#!/bin/sh
# Offload RAW piezo files from the pod to the NAS before firmware/archive
# pruning destroys them. Runs on the pod from a systemd timer (see
# systemd/free-sleep-offload-raw.timer). BusyBox-ash compatible: no arrays,
# no [[ ]].
#
# The pod has scp but no rsync, so we track transferred files in a manifest
# and scp anything new. Files are only offloaded once their mtime is >2 min
# old — frankenfirmware appends to the newest RAW continuously, so a stale
# mtime means the file is complete.
#
# Config comes from offload.env next to this script:
#   NAS_USER, NAS_HOST, NAS_PATH, NAS_SSH_PORT (default 22), SSH_KEY
#
# Destination layout: $NAS_PATH/YYYY-MM/<name>.RAW (month folder by file
# mtime). Compression happens NAS-side (see nas-compress-raw.sh) — the pod's
# CPU must stay free for the biometrics stream.
#
# Failure mode: if the NAS is down or the key isn't authorized yet, every
# run logs one line and exits 0 so the timer keeps trying. Nothing is ever
# deleted from the pod by this script; local retention stays owned by the
# firmware buffer and archive-raw.sh.

set -u

DIR=$(dirname "$0")
[ -f "$DIR/offload.env" ] && . "$DIR/offload.env"

NAS_USER=${NAS_USER:?offload.env must set NAS_USER}
NAS_HOST=${NAS_HOST:?offload.env must set NAS_HOST}
NAS_PATH=${NAS_PATH:?offload.env must set NAS_PATH}
NAS_SSH_PORT=${NAS_SSH_PORT:-22}
SSH_KEY=${SSH_KEY:-/home/root/.ssh/id_offload_nas}

STATE_DIR=/persistent/free-sleep-data/offload
MANIFEST=$STATE_DIR/sent.list
mkdir -p "$STATE_DIR"
touch "$MANIFEST"

SSH_OPTS="-i $SSH_KEY -p $NAS_SSH_PORT -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"

# Fast reachability probe so an offline NAS costs one line, not one timeout
# per file.
if ! ssh $SSH_OPTS "$NAS_USER@$NAS_HOST" "true" 2>/dev/null; then
  echo "offload-raw: NAS unreachable or key not authorized ($NAS_USER@$NAS_HOST:$NAS_SSH_PORT), will retry"
  exit 0
fi

sent=0
skipped=0
failed=0

# Candidate sources: live firmware files + the local archive if present.
for src in $(find /persistent -maxdepth 1 -name '*.RAW' -mmin +2; \
             find /persistent/free-sleep-data/raw-archive -maxdepth 1 -name '*.RAW' -mmin +2 2>/dev/null); do
  base=$(basename "$src")
  [ "$base" = "SEQNO.RAW" ] && continue
  if grep -qx "$base" "$MANIFEST"; then
    skipped=$((skipped + 1))
    continue
  fi
  month=$(date -d "@$(stat -c %Y "$src")" +%Y-%m 2>/dev/null || date +%Y-%m)
  dest_dir="$NAS_PATH/$month"
  if ! ssh $SSH_OPTS "$NAS_USER@$NAS_HOST" "mkdir -p '$dest_dir'" 2>/dev/null; then
    failed=$((failed + 1)); continue
  fi
  if scp $SSH_OPTS -q "$src" "$NAS_USER@$NAS_HOST:$dest_dir/$base" 2>/dev/null; then
    # Verify size before marking sent — a truncated copy marked done is
    # data silently lost forever once local pruning catches up.
    local_size=$(stat -c %s "$src")
    remote_size=$(ssh $SSH_OPTS "$NAS_USER@$NAS_HOST" "stat -c %s '$dest_dir/$base' 2>/dev/null || stat -f %z '$dest_dir/$base'" 2>/dev/null)
    if [ "$local_size" = "$remote_size" ]; then
      echo "$base" >> "$MANIFEST"
      sent=$((sent + 1))
    else
      failed=$((failed + 1))
    fi
  else
    failed=$((failed + 1))
  fi
done

# Keep the manifest bounded (~3 months of filenames is plenty; re-sending
# an already-present file is harmless, scp just overwrites identical bytes).
if [ "$(wc -l < "$MANIFEST")" -gt 20000 ]; then
  tail -n 10000 "$MANIFEST" > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"
fi

if [ "$sent" -gt 0 ] || [ "$failed" -gt 0 ]; then
  echo "offload-raw: sent=$sent skipped=$skipped failed=$failed -> $NAS_USER@$NAS_HOST:$NAS_PATH"
fi
