#!/bin/bash
# Puts a migration target's original install back exactly the way it was
# found. This is the fork-switch tool's safety net: it's copied to
# /home/dac/restore-original-fork.sh BEFORE the swap
# so it survives regardless of what state either tree ends up in, and it's
# called from two places:
#
#   1. pod-installer.sh's own failure path (attended: the installer is still
#      running and calls this directly when something goes wrong pre- or
#      post-swap).
#   2. The dead-man sentinel (unattended: a persistent systemd timer armed
#      right before the swap and disarmed right after a successful health
#      check, if the installer is killed, OOM'd, or the pod loses power
#      mid-swap, this timer fires this same script on its own within
#      minutes, with no laptop or user needed).
#
# Idempotent by design, safe to run whether the swap never happened, half
# happened, or already happened: it acts only when the installer's swap marker
# proves a swap actually began ($SWAP_MARKER exists), and every step tolerates
# its target already being absent/undone. The marker, not the mere existence of
# $PREV, is the signal, because the pod's own updater may keep an unrelated
# rollback tree at $PREV from before we ever ran; keying off $PREV alone would
# both mistake that stale tree for the install we swapped out and wrongly undo a
# migration that already succeeded (its marker is gone). $PREV uses the same path
# update.sh/rollback_pod.sh use for "the previous tree" deliberately: on success
# this directory becomes the in-app instant-rollback slot, so the migrated pod's
# Settings page recognizes it immediately.
set -uo pipefail

LIVE=/home/dac/free-sleep
PREV=/home/dac/free-sleep-prev
# The installer stashes any pre-existing $PREV here so we can put the pod's own
# rollback slot back exactly as we found it; $SWAP_MARKER is its swap-in-progress flag.
PREEXISTING_PREV=/home/dac/free-sleep-prev-preexisting
SWAP_MARKER=/home/dac/free-sleep-migrate-swapped
ABORTED_QUARANTINE=/home/dac/free-sleep-migrate-aborted
IPTABLES_SNAPSHOT=/home/dac/free-sleep-migrate-iptables-snapshot.rules
STATUS_FILE=/persistent/free-sleep-data/migration-status.json
SENTINEL_UNIT=free-sleep-migrate-sentinel.timer
SYSTEMD_DIR=/etc/systemd/system
PID_FILE=/home/dac/free-sleep-migrate.pid
STAGE=/home/dac/free-sleep-migrate-staging
ZIP=/home/dac/free-sleep-migrate.zip

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] restore-original-fork: $*"; }

write_status() {
  # Best-effort JSON write, this script must never fail because the status
  # file couldn't be written; the directory swap is what actually matters.
  mkdir -p "$(dirname "$STATUS_FILE")" 2>/dev/null || true
  printf '{"stage":"restore","outcome":"%s","message":"%s","timestamp":"%s"}\n' \
    "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATUS_FILE" 2>/dev/null || true
}

disarm_sentinel() {
  systemctl disable --now "$SENTINEL_UNIT" >/dev/null 2>&1 || true
  rm -f "$SYSTEMD_DIR/$SENTINEL_UNIT" "$SYSTEMD_DIR/free-sleep-migrate-sentinel.service" 2>/dev/null || true
  systemctl daemon-reload >/dev/null 2>&1 || true
}

restore_iptables() {
  if [ -f "$IPTABLES_SNAPSHOT" ]; then
    say "Restoring pre-migration iptables snapshot"
    iptables-restore < "$IPTABLES_SNAPSHOT" 2>/dev/null || say "WARNING: iptables-restore failed"
  fi
}

cleanup_nightstand_services() {
  # Remove only files owned by Nightstand. Preserve other drop-ins.
  systemctl disable --now free-sleep-archive-raw.timer free-sleep-health.timer free-sleep-network-watchdog.timer >/dev/null 2>&1 || true
  systemctl stop free-sleep-archive-raw.service >/dev/null 2>&1 || true
  rm -f "$SYSTEMD_DIR/free-sleep-archive-raw.timer" "$SYSTEMD_DIR/free-sleep-archive-raw.service" \
    "$SYSTEMD_DIR/free-sleep-health.timer" "$SYSTEMD_DIR/free-sleep-health.service" \
    "$SYSTEMD_DIR/free-sleep-network-watchdog.timer" "$SYSTEMD_DIR/free-sleep-network-watchdog.service" \
    "$SYSTEMD_DIR/free-sleep.service.d/10-nightstand-limits.conf" \
    "$SYSTEMD_DIR/free-sleep-stream.service.d/10-nightstand-limits.conf"
  systemctl daemon-reload >/dev/null 2>&1 || true
}

# Their stream comes back only if their Pod had it enabled. The migration
# stops it but never enables or disables it, and this can run after a reboot,
# so systemd's saved state is the record of their choice.
start_stream_if_enabled() {
  if [ "$(systemctl is-enabled free-sleep-stream 2>/dev/null)" = enabled ]; then
    systemctl start free-sleep-stream >/dev/null 2>&1 || true
  fi
}

cleanup_temporary_files() {
  rm -rf "$ABORTED_QUARANTINE" "$STAGE" "$STAGE.unzip"
  rm -f "$ZIP" "$PID_FILE" "$IPTABLES_SNAPSHOT" /home/dac/free-sleep-migrate.lock \
    /home/dac/free-sleep-migrate-baseline.json /tmp/free-sleep-migrate-health
}

stop_active_installer() {
  # systemd stops the entire installer cgroup, including npm/Prisma children.
  if systemctl is-active --quiet free-sleep-migrate.service; then
    systemctl stop free-sleep-migrate.service || return 1
  elif [ -f "$PID_FILE" ]; then
    local installer_pid installer_group
    installer_pid=$(cat "$PID_FILE")
    case "$installer_pid" in ''|*[!0-9]*) return 1 ;; esac
    if kill -0 "$installer_pid" 2>/dev/null; then
      # The nohup launcher uses setsid. Refuse to kill an unrelated process or
      # restore alongside a runner whose descendants cannot be stopped safely.
      [ "$installer_pid" != "$$" ] && [ "$installer_pid" != "$PPID" ] || return 1
      tr '\0' ' ' < "/proc/$installer_pid/cmdline" | grep -q '/migrate/pod-installer.sh' || return 1
      installer_group=$(ps -o pgid= -p "$installer_pid" | tr -d ' ')
      [ "$installer_group" = "$installer_pid" ] || return 1
      kill -STOP -- "-$installer_group" || return 1
      kill -KILL -- "-$installer_group" || return 1
    fi
  fi
}

if [ "${1:-}" = "--sentinel" ]; then
  stop_active_installer || {
    say "FATAL: could not stop active installer; refusing a concurrent restore"
    write_status "restore_failed" "installer could not be stopped safely"
    exit 1
  }
fi

if [ ! -f "$SWAP_MARKER" ]; then
  say "No swap marker, the swap never began (or already completed successfully)."
  # If the installer set the pod's own rollback slot aside but died before the
  # swap, put it back so their instant-rollback still works. When $PREV is
  # already present it's the pod's own untouched slot, leave it alone.
  if [ ! -d "$PREV" ] && [ -d "$PREEXISTING_PREV" ]; then
    say "Restoring the pod's pre-existing rollback slot to $PREV"
    mv "$PREEXISTING_PREV" "$PREV" 2>/dev/null || say "WARNING: could not restore $PREV"
  fi
  disarm_sentinel
  restore_iptables
  # pod-installer.sh may have already stopped their service before hitting a
  # failure that lands here (e.g. it failed to even move $LIVE aside);
  # restarting is a safe no-op if it's already running.
  systemctl start free-sleep >/dev/null 2>&1 || true
  start_stream_if_enabled
  cleanup_temporary_files
  write_status "no_op" "no swap in progress"
  say "Nothing to move, their service has been (re)started just in case. Done."
  exit 0
fi

say "Swap marker present, reverting the migration to the original install."

systemctl stop free-sleep >/dev/null 2>&1 || true
systemctl stop free-sleep-stream >/dev/null 2>&1 || true

# $PREV holds their original tree only if the $LIVE->$PREV move completed. If we
# died between the marker and that move, $LIVE still holds their tree untouched,
# so don't quarantine it; just fall through to restoring their rollback slot.
if [ -d "$PREV" ]; then
  if [ -d "$LIVE" ]; then
    rm -rf "$ABORTED_QUARANTINE"
    mv "$LIVE" "$ABORTED_QUARANTINE" || {
      say "FATAL: could not move $LIVE aside. The original tree remains at $PREV; manual recovery may be required."
      write_status "restore_failed" "could not move current tree aside; original tree preserved"
      # Keep the marker and sentinel: moving PREV into an existing LIVE would
      # nest it inside the failed build instead of restoring it.
      exit 1
    }
  fi
  mv "$PREV" "$LIVE" || {
    say "FATAL: could not move $PREV into place. Manual recovery needed:"
    say "  the untouched original tree is at $PREV"
    write_status "restore_failed" "could not move original tree into place"
    exit 1
  }
fi

# Put the pod's own pre-existing rollback slot back exactly where it was, so
# their updater's instant-rollback still works after we bow out. $PREV is now
# free (moved into $LIVE just above, or never populated).
if [ -d "$PREEXISTING_PREV" ]; then
  say "Restoring the pod's pre-existing rollback slot to $PREV"
  rm -rf "$PREV"
  mv "$PREEXISTING_PREV" "$PREV" 2>/dev/null || say "WARNING: could not restore the pod's pre-existing rollback slot at $PREV"
fi

cleanup_nightstand_services
restore_iptables

say "Starting their original service"
systemctl start free-sleep >/dev/null 2>&1 \
  || say "WARNING: 'systemctl start free-sleep' failed, their fork may use a different service name; the tree is restored regardless"
start_stream_if_enabled

sleep 8
if curl -sf --max-time 5 "http://127.0.0.1:3000/api/deviceStatus" >/dev/null 2>&1 \
  || curl -sf --max-time 5 "http://127.0.0.1:3000/" >/dev/null 2>&1; then
  say "Their original install is back and responding."
  write_status "auto-restored" "original fork restored and responding"
else
  say "Original tree restored but not yet responding, it may just be starting up. Check: systemctl status free-sleep"
  write_status "auto-restored" "original fork restored; health not yet confirmed"
fi

rm -f "$SWAP_MARKER"
cleanup_temporary_files
disarm_sentinel
say "Done."
