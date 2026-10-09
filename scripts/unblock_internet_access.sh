#!/bin/bash

echo "Unblocking internet access..."

iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X

ip6tables -F
ip6tables -X
ip6tables -t nat -F 2>/dev/null || true
ip6tables -t nat -X 2>/dev/null || true

POLICY_FAILED=no
iptables -P OUTPUT ACCEPT || POLICY_FAILED=yes
ip6tables -P OUTPUT ACCEPT || POLICY_FAILED=yes
if [ "$POLICY_FAILED" = yes ]; then
  echo "ERROR: could not restore OUTPUT policies" >&2
  exit 1
fi

echo "Unblocked internet access!"
