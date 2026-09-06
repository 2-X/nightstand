#!/bin/bash
# NAS-side puller for RAW piezo files. Runs from cron on the NAS (UGREEN
# DXP480T Plus, Debian bookworm), fetches new RAW files from the pod over
# scp, verifies sizes, sorts into month folders, and zstd-compresses files
# older than 2 days (measured 2.26x on real Pod 4 piezo data).
#
# Pull direction is deliberate: the NAS holds a key into the pod, never the
# reverse, so a compromised pod can't reach the NAS. The key lives at
# $BASE/.keys/pod_pull and is authorized on the pod's root account (sshd
# port 8822).
#
# Local presence (name.RAW or name.RAW.zst anywhere under raw/) is the
# transfer manifest — no state files. Firmware sequence names could in
# theory reset after a reflash; a same-name file with a different size is
# re-fetched under a .conflict suffix rather than skipped or overwritten.
#
# Install: cron entry every 10 min (see PLAN.md). The pod's firmware buffer
# holds ~6h of files, so even a day of NAS downtime loses nothing as long
# as the pod-local archive timer is running.

set -u
BASE=/volume1/misc/eight-sleep
RAW=$BASE/raw
KEY=$BASE/.keys/pod_pull
LOCK=$BASE/.pull.lock
LOG=$BASE/pull.log
POD_PORT=8822
# IP first: UGOS has no mDNS resolver, .local is a fallback in case the
# DHCP lease ever moves.
POD_HOSTS="192.168.4.54 eight-pod.local"

exec 9>"$LOCK"
flock -n 9 || exit 0

# Keep the log bounded.
[ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 5242880 ] && tail -c 1048576 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

# igreen has no home dir on UGOS, so ssh needs an explicit known_hosts path.
# Port is NOT in the shared opts: ssh takes -p, scp takes -P, and passing
# ssh's -p to scp silently means "preserve times" and eats the port number.
SSH_OPTS="-i $KEY -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$BASE/.keys/known_hosts"

POD=""
for h in $POD_HOSTS; do
  if ssh -p $POD_PORT $SSH_OPTS "root@$h" true 2>/dev/null; then POD=$h; break; fi
done
if [ -z "$POD" ]; then
  echo "$(date -Is) pod unreachable" >> "$LOG"
  exit 0
fi

mkdir -p "$RAW"

# Remote listing: "size mtime path" for complete files (mtime > 2 min old;
# the firmware appends to the newest file continuously). Same inode may
# appear under /persistent and the raw-archive (hardlinks) — dedupe by name.
listing=$(ssh -p $POD_PORT $SSH_OPTS "root@$POD" \
  "find /persistent -maxdepth 1 -name '*.RAW' -mmin +2 -exec stat -c '%s %Y %n' {} \; ; \
   find /persistent/free-sleep-data/raw-archive -maxdepth 1 -name '*.RAW' -mmin +2 -exec stat -c '%s %Y %n' {} \; 2>/dev/null" 2>/dev/null)

fetched=0; skipped=0; failed=0
seen=""
while read -r size mtime path; do
  [ -z "${path:-}" ] && continue
  base=$(basename "$path")
  [ "$base" = "SEQNO.RAW" ] && continue
  case " $seen " in *" $base "*) continue ;; esac
  seen="$seen $base"

  existing=$(find "$RAW" \( -name "$base" -o -name "$base.zst" \) | head -1)
  if [ -n "$existing" ]; then
    if [ "${existing%.zst}" = "$existing" ] && [ "$(stat -c %s "$existing")" != "$size" ]; then
      base="$base.conflict-$(date +%s)"   # sequence-reset collision, keep both
    else
      skipped=$((skipped + 1)); continue
    fi
  fi

  month=$(date -d "@$mtime" +%Y-%m)
  mkdir -p "$RAW/$month"
  if scp -O -P $POD_PORT $SSH_OPTS -pq "root@$POD:$path" "$RAW/$month/$base.part" 2>/dev/null \
     && [ "$(stat -c %s "$RAW/$month/$base.part")" = "$size" ]; then
    mv "$RAW/$month/$base.part" "$RAW/$month/$base"
    fetched=$((fetched + 1))
  else
    rm -f "$RAW/$month/$base.part"
    failed=$((failed + 1))
  fi
done <<< "$listing"

# Compress anything older than 2 days that's still uncompressed.
compressed=0
while IFS= read -r f; do
  zstd -q --rm -T2 "$f" && compressed=$((compressed + 1))
done < <(find "$RAW" -name '*.RAW' -mtime +2)

if [ "$fetched" -gt 0 ] || [ "$failed" -gt 0 ] || [ "$compressed" -gt 0 ]; then
  echo "$(date -Is) pod=$POD fetched=$fetched skipped=$skipped failed=$failed compressed=$compressed" >> "$LOG"
fi
