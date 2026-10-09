#!/bin/bash
# Shared restore steps, sourced before either application tree moves.

has_switch_journal() {
  local root="${1:-${NIGHTSTAND_TRANSACTION_ROOT:-/persistent/free-sleep-maintenance/nightstand-transactions}}" journal
  for journal in "$root"/*/journal.json; do
    if [ -e "$journal" ] || [ -L "$journal" ]; then return 0; fi
  done
  return 1
}

restore_stop_writer() {
  systemctl stop "$1" 2>/dev/null
  case "$(systemctl is-active "$1" 2>/dev/null)" in
    inactive|failed|unknown) return 0 ;;
  esac
  return 1
}

# Switch recovery restores offline and queues starts without waiting for the
# boot recovery unit itself to exit.
restore_switch_offline() {
  python3 -B "$1/recover_switch.py" --root "$2" restore --helper "$1/restore_helpers.sh"
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
  systemctl start free-sleep || {
    RESTORE_SERVICE_ERROR="start free-sleep failed"
    return 1
  }
  if [ "$STREAM_WAS_ACTIVE" = active ]; then
    if [ "$stream_errors" = strict ]; then
      systemctl restart free-sleep-stream || {
        RESTORE_SERVICE_ERROR="restart free-sleep-stream failed"
        return 1
      }
    else
      systemctl restart free-sleep-stream 2>/dev/null || true
    fi
  fi
}

# Cross-fork swaps require the retained installation's companion state.
restore_cross_fork_rollback() {
  local runner="$LIVE/scripts/switch_installation.py"
  [ -f "$runner" ] || return 1
  python3 -B "$runner" companion --stage "$PREV" >/dev/null || return 1
  python3 -B "$runner" rollback --stage "$PREV" --recheck-in-use "${RECHECK_IN_USE:-no}"
}

init_update_firewall() {
  # iptables 1.6.0 added "-w SECONDS"; older builds take a bare -w or no flag.
  IPT_W=(-w 5)
  if ! iptables "${IPT_W[@]}" -S OUTPUT >/dev/null 2>&1; then
    IPT_W=(-w)
    if ! iptables "${IPT_W[@]}" -S OUTPUT >/dev/null 2>&1; then
      IPT_W=()
    fi
  fi
}

fw4() { iptables ${IPT_W[@]+"${IPT_W[@]}"} "$@"; }
fw6() { ip6tables ${IPT_W[@]+"${IPT_W[@]}"} "$@"; }
# Clear an emergency policy only after both families have terminal blocks.
restore_output_policy() {
  if { fw4 -C OUTPUT -j REJECT 2>/dev/null || fw4 -C OUTPUT -j DROP 2>/dev/null; } &&
     { fw6 -C OUTPUT -j REJECT 2>/dev/null || fw6 -C OUTPUT -j DROP 2>/dev/null; }; then
    local policy_failed=no
    fw4 -P OUTPUT ACCEPT || { echo "WARNING: could not restore IPv4 OUTPUT policy"; policy_failed=yes; }
    fw6 -P OUTPUT ACCEPT || { echo "WARNING: could not restore IPv6 OUTPUT policy"; policy_failed=yes; }
    # Download windows change live policies only.
    if [ "${1:-}" = save ] && [ "${WAN_OPEN:-no}" = no ] && [ "$policy_failed" = no ] &&
       fw4 -C INPUT -j DROP 2>/dev/null && fw6 -C INPUT -j DROP 2>/dev/null; then
      if ! iptables-save > /etc/iptables/iptables.rules ||
         ! ip6tables-save > /etc/iptables/ip6tables.rules; then
        echo "WARNING: could not save recovered firewall rules"
      fi
    fi
  fi
}
