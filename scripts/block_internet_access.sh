#!/bin/bash

echo "Blocking internet access..."

# IPv4 Rules
echo "Configuring IPv4 rules..."

# Start from a clean slate so the final ruleset is exactly what this script
# writes, no matter what was in the chains before (a prior unblock, leftovers
# from an old saved state, temporary deploy rules). Without this, stale ACCEPT
# rules sitting above our final DROP survive re-blocking and then get
# immortalized by the iptables-save at the bottom - which is exactly how the
# WAN sat open for months (discovered Sep 2026).
iptables -F INPUT
iptables -F OUTPUT

# -----------------------------------------------------------------------------------------------------
# Allow return traffic for connections this pod initiates (DNS answers,
# TCP 443 responses). The outbound allows further down only open the forward
# direction; without these conntrack rules the INPUT DROP at the end would
# eat the responses. Unconditional: this is core firewall plumbing, not
# specific to any one allowed destination below.
iptables -C INPUT  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
iptables -I INPUT  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -C OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
iptables -I OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# -----------------------------------------------------------------------------------------------------

# Allow LAN traffic Class A (10.0.0.0/8)
iptables -A INPUT -s 10.0.0.0/8 -j ACCEPT
iptables -A OUTPUT -d 10.0.0.0/8 -j ACCEPT

# Allow LAN traffic Class B (172.16.0.0/12)
iptables -A INPUT -s 172.16.0.0/12 -j ACCEPT
iptables -A OUTPUT -d 172.16.0.0/12 -j ACCEPT

# Allow LAN traffic Class C (192.168.0.0/16)
iptables -A INPUT -s 192.168.0.0/16 -j ACCEPT
iptables -A OUTPUT -d 192.168.0.0/16 -j ACCEPT

# Allow NTP traffic - this allows us to synchronize the system time
iptables -I OUTPUT -p udp --dport 123 -j ACCEPT
iptables -I INPUT -p udp --sport 123 -j ACCEPT

echo "Updating the timesyncd config"
# New configuration content
cat > /etc/systemd/timesyncd.conf <<EOF
[Time]
NTP=pool.ntp.org 0.pool.ntp.org 1.pool.ntp.org 2.pool.ntp.org 3.pool.ntp.org
FallbackNTP=time1.google.com time2.google.com time3.google.com time4.google.com
RootDistanceMaxSec=5
PollIntervalMinSec=32
PollIntervalMaxSec=2048
EOF

# Restart timesyncd to apply changes
systemctl restart systemd-timesyncd


# Allow localhost (loopback) traffic so local apps can talk to each other
iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# -----------------------------------------------------------------------------------------------------
# Allow Tailscale (https://tailscale.com/kb/1082/firewall-ports)
#
# Tailscale gives us remote access to the pod from outside the LAN without
# exposing it to the public internet. Without these rules, the OUTPUT DROP
# below would block tailscaled from reaching its control plane and DERP relays.
#
# (1) Anything on the tailscale interface: the VPN payload between the user's
#     devices and this pod (e.g., phone browser -> https://eight-pod).
iptables -A INPUT  -i tailscale0 -j ACCEPT
iptables -A OUTPUT -o tailscale0 -j ACCEPT

# (2) tailscaled needs outbound to talk to peers + Tailscale's control plane:
#       - UDP everywhere: direct WireGuard peer connections + STUN
#       - TCP/443: control plane (controlplane.tailscale.com) + DERP relays
#       - DNS: to resolve controlplane.tailscale.com / derp*.tailscale.com
#     Note: this allows the pod to reach any HTTPS host, not only Tailscale -
#     including Eight Sleep's cloud. So these rules are added ONLY while
#     tailscaled is actually running (Sep 2026: it sat inactive for months
#     while these rules silently held the WAN open for everything). Eight
#     Sleep's OTA updates are additionally blocked at the systemd level
#     (services masked per INSTALLATION.md); this firewall is a second layer.
#     If you enable Tailscale later, re-run this script while tailscaled is
#     active to get these rules back.
if systemctl is-active --quiet tailscaled; then
  echo "tailscaled active: allowing its control-plane/DERP/STUN egress"
  iptables -A OUTPUT -p udp -j ACCEPT
  iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT
  iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
  iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
else
  echo "tailscaled inactive: skipping its WAN egress rules (full block)"
fi
# -----------------------------------------------------------------------------------------------------

# Block everything else
iptables -A INPUT -j DROP
iptables -A OUTPUT -j DROP

# Save rules
iptables-save > /etc/iptables/iptables.rules

echo "Configuring IPv6 rules..."
# Allow local traffic for IPv6
ip6tables -A INPUT -s fe80::/10 -j ACCEPT
ip6tables -A OUTPUT -d fe80::/10 -j ACCEPT
ip6tables -A INPUT -s fd00::/8 -j ACCEPT
ip6tables -A OUTPUT -d fd00::/8 -j ACCEPT

# Allow NTP traffic (IPv6)
ip6tables -I OUTPUT -p udp --dport 123 -j ACCEPT
ip6tables -I INPUT -p udp --sport 123 -j ACCEPT

# Block everything else (IPv6)
ip6tables -A INPUT -j DROP
ip6tables -A OUTPUT -j DROP
ip6tables-save > /etc/iptables/ip6tables.rules

echo "Blocked WAN internet access successfully!"

