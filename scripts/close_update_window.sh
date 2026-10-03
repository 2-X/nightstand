#!/bin/bash
# Runs after the update and revert units stop, however they stopped. An
# updater that was killed outright leaves its download rules in OUTPUT, at
# the top unless another rule was inserted since; remove them wherever they
# are and apply the block again. When the firewall has no final DROP,
# internet access was opened on purpose, so only the download rules go.
# Does nothing when no download rules are left.
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

WAN_RULES=("-p tcp --dport 443 -j ACCEPT" "-p udp --dport 53 -j ACCEPT" "-p tcp --dport 53 -j ACCEPT")
WAN_RULE6="-p tcp --dport 443 -j REJECT --reject-with tcp-reset"

# OUTPUT's rules, one per line, with whitespace and the implicit -m tcp or
# -m udp normalized so they compare with the rules above.
output_rules() {
  "$1" -S OUTPUT 2>/dev/null | awk '$1 == "-A" && $2 == "OUTPUT" { $1 = $2 = ""; $0 = $0; $1 = $1; print }' \
    | sed -e 's/ -m tcp//g' -e 's/ -m udp//g'
}

# The download rules left in IPv4 OUTPUT, one line per copy. The block script
# adds the same three rules itself while Tailscale runs, right after its UDP
# allow, so one copy of each is kept when that run is there.
left_open() {
  output_rules fw4 | awk -v https="${WAN_RULES[0]}" -v udp_dns="${WAN_RULES[1]}" -v tcp_dns="${WAN_RULES[2]}" '
    { rule[NR] = $0; count[$0]++ }
    END {
      kept = 0
      for (i = 1; i + 3 <= NR; i++)
        if (rule[i] == "-p udp -j ACCEPT" && rule[i + 1] == https && rule[i + 2] == udp_dns && rule[i + 3] == tcp_dns) kept = 1
      for (spec in count)
        if (spec == https || spec == udp_dns || spec == tcp_dns)
          for (copies = count[spec]; copies > kept; copies--) print spec
    }'
}

# The window inserts its rules at the top and nothing adds the same ones
# above them, so deleting the first match removes the window's copy and
# leaves every other rule in place.
REMOVED=0
while IFS= read -r spec; do
  [ -n "$spec" ] || continue
  # shellcheck disable=SC2086
  fw4 -D OUTPUT $spec && REMOVED=$((REMOVED + 1))
done <<RULES
$(left_open)
RULES
# IPv6 has no rule like this one but the window's.
while [ "$REMOVED" -lt 20 ] && output_rules fw6 | grep -Fxq -- "$WAN_RULE6"; do
  # shellcheck disable=SC2086
  fw6 -D OUTPUT $WAN_RULE6 || break
  REMOVED=$((REMOVED + 1))
done
[ "$REMOVED" -gt 0 ] || exit 0
echo "Removed the download rules an interrupted update left open"
if fw4 -C OUTPUT -j DROP 2>/dev/null; then
  sh "$LIVE/scripts/block_internet_access.sh" >/dev/null 2>&1 \
    || sh "$PREV/scripts/block_internet_access.sh" >/dev/null 2>&1 \
    || echo "WARNING: could not apply the block script again"
fi
exit 0
