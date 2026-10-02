#!/bin/bash
# Runs after the update and revert units stop, however they stopped. An
# updater that was killed outright leaves its download rules at the top of
# OUTPUT; remove them and apply the block again. When the firewall has no
# final DROP, internet access was opened on purpose, so only the download
# rules go. Does nothing when no download rules are left.
LIVE=/home/dac/free-sleep
PREV=/home/dac/free-sleep-prev

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
# where the updaters insert them, so the same rule further down (Tailscale's
# HTTPS allow) is left alone. Rules are compared with whitespace and the
# implicit -m tcp/-m udp normalized. Prints how many were removed.
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

REMOVED=$(strip_top fw4 "-p tcp --dport 443 -j ACCEPT" "-p udp --dport 53 -j ACCEPT" "-p tcp --dport 53 -j ACCEPT")
strip_top fw6 "-p tcp --dport 443 -j REJECT --reject-with tcp-reset" >/dev/null
[ "$REMOVED" -gt 0 ] || exit 0
echo "Removed the download rules an interrupted update left open"
if fw4 -C OUTPUT -j DROP 2>/dev/null; then
  sh "$LIVE/scripts/block_internet_access.sh" >/dev/null 2>&1 \
    || sh "$PREV/scripts/block_internet_access.sh" >/dev/null 2>&1 \
    || echo "WARNING: could not apply the block script again"
fi
exit 0
