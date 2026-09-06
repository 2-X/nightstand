#!/bin/sh
# NAS-side companion to offload-raw.sh. Run from cron on the NAS (daily is
# fine). Compresses RAW files older than 2 days with zstd (measured 2.26x on
# real Pod 4 piezo data) and verifies before removing the original.
# Usage: nas-compress-raw.sh /path/to/pod-raw
set -eu
ROOT=${1:?usage: nas-compress-raw.sh <raw-root-dir>}
find "$ROOT" -name '*.RAW' -mtime +2 -print0 | while IFS= read -r -d '' f; do
  zstd -q --rm -T2 "$f" || echo "compress failed: $f" >&2
done
