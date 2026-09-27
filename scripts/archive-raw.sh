#!/usr/bin/env bash
# Hardlink RAW piezo files from /persistent/ into a local archive so they
# survive frankenfirmware's rolling-buffer truncation (~75 min).
#
# Background: frankenfirmware (Eight Sleep's proprietary firmware) writes
# one ~6.7 MB RAW file every ~15 min and maintains a fixed-size rolling
# buffer of the most recent N files. After uploading to Eight Sleep's
# cloud (or attempting to, sometimes uploads time out), the firmware
# truncates files older than the buffer window. Net effect: by ~midday,
# the previous night's data is GONE from /persistent/ and the daily
# analyze_sleep job finds nothing.
#
# Hardlinks share inodes: frank's `rm` removes ITS filesystem entry,
# but our entry in the archive folder keeps the inode (the actual data
# bytes) alive until WE delete it. Doesn't break Eight Sleep's cloud
# sync, doesn't double the disk usage (until frank actually deletes,
# the two paths share the same data blocks).
#
# Run this from a systemd timer every minute. With ~15 min between
# new RAW files, a 1-min cadence has plenty of margin.

set -e

# The overrides exist for tests; systemd runs this with none of them set.
PERSIST=${ARCHIVE_RAW_PERSIST:-/persistent}
ARCHIVE=${ARCHIVE_RAW_DIR:-/persistent/free-sleep-data/raw-archive}
CONF=${ARCHIVE_RAW_CONF:-/persistent/free-sleep-data/raw-archive.conf}
MIN_FREE_KB=${ARCHIVE_RAW_MIN_FREE_KB:-2097152}

# 14 days by default. The server writes CONF from the retention setting.
# CONF sits in a directory the server user can write and this script runs as
# root, so the value is parsed as a bare number and never sourced.
RETENTION_HOURS=336
if [ -f "$CONF" ]; then
  conf_hours=$(sed -n 's/^RETENTION_HOURS=\([0-9]\{1,5\}\)$/\1/p' "$CONF" 2>/dev/null | head -1)
  if [ -n "$conf_hours" ] && [ "$conf_hours" -ge 24 ] && [ "$conf_hours" -le 1440 ]; then
    RETENTION_HOURS=$conf_hours
  fi
fi

mkdir -p "$ARCHIVE"
# Root deletes files in here, so refuse a directory swapped for a link.
if [ -L "$ARCHIVE" ]; then
  echo "archive-raw: refusing to run, $ARCHIVE is a symlink"
  exit 1
fi

linked=0
for src in "$PERSIST"/*.RAW; do
  [ -f "$src" ] || continue
  base=$(basename "$src")
  # Skip the firmware's sequencer state file
  [ "$base" = "SEQNO.RAW" ] && continue
  dst="$ARCHIVE/$base"
  [ -e "$dst" ] && continue
  if ln "$src" "$dst" 2>/dev/null; then
    linked=$((linked + 1))
  fi
done

# Prune the archive to keep only the last RETENTION_HOURS of files. The
# archive grows by roughly 0.4 GB a day.
pruned=$(($(find "$ARCHIVE" -type f -name '*.RAW' -mmin "+$((RETENTION_HOURS * 60))" -print -delete 2>/dev/null | wc -l)))

free_kb() {
  df -kP "$ARCHIVE" 2>/dev/null | awk 'NR == 2 { print $4 }'
}

# Keep at least MIN_FREE_KB free on the data partition by dropping the oldest
# archived files first. Sorted by mtime: the firmware's file names are
# sequence numbers, not times.
floor_pruned=0
avail=$(free_kb)
while [ -n "$avail" ] && [ "$avail" -lt "$MIN_FREE_KB" ]; do
  oldest=$(ls -1tr "$ARCHIVE"/*.RAW 2>/dev/null | head -1)
  if [ -z "$oldest" ]; then
    echo "archive-raw: WARNING free space ${avail}KB is below ${MIN_FREE_KB}KB with the archive empty; something else is filling the disk"
    break
  fi
  rm -f -- "$oldest"
  floor_pruned=$((floor_pruned + 1))
  avail=$(free_kb)
done

# Quiet on idle, single-line summary on activity (avoids journald spam
# but keeps the timer's output meaningful when something happens).
if [ "$linked" -gt 0 ] || [ "$pruned" -gt 0 ] || [ "$floor_pruned" -gt 0 ]; then
  echo "archive-raw: linked=$linked pruned=$pruned floor_pruned=$floor_pruned (retention=${RETENTION_HOURS}h)"
fi
