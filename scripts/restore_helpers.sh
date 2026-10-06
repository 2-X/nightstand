#!/bin/bash
# Shared restore steps, sourced before either application tree moves.

restore_stop_writer() {
  systemctl stop "$1" 2>/dev/null
  case "$(systemctl is-active "$1" 2>/dev/null)" in
    inactive|failed|unknown) return 0 ;;
  esac
  return 1
}

restore_dependencies() {
  local source=$1
  if [ -d "$source/server/node_modules" ] && [ ! -d "$LIVE/server/node_modules" ] \
    && cmp -s "$LIVE/server/package-lock.json" "$source/server/package-lock.json"; then
    mv "$source/server/node_modules" "$LIVE/server/node_modules"
    chown -R dac:dac "$LIVE/server/node_modules"
  fi
}

restore_restart_services() {
  local stream_errors=$1
  shift
  if [ "${ARCHIVE_WAS_ACTIVE:-inactive}" = active ] && [ -f "$LIVE/scripts/archive-raw.sh" ]; then
    systemctl start free-sleep-archive-raw.timer >/dev/null 2>&1 || true
  fi
  if [ -f "$LIVE/scripts/block_internet_access.sh" ]; then
    if [ "$#" -gt 0 ]; then
      "$@" || say "WARNING: restored firewall could not be applied"
    else
      sh "$LIVE/scripts/block_internet_access.sh" || say "WARNING: restored firewall could not be applied"
    fi
  fi
  systemctl start free-sleep
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    if [ "$stream_errors" = strict ]; then
      systemctl restart free-sleep-stream
    else
      systemctl restart free-sleep-stream 2>/dev/null || true
    fi
  fi
}
