#!/bin/bash
#
# Bound Nightstand's own services so they cannot starve the pod's firmware.
#
# The pod has about 1.9 GB of RAM, no swap, and earlyoom. The Eight Sleep
# firmware that runs heating and cooling shares that memory with the server,
# the sleep analysis and calibration jobs the server starts, and the
# biometrics stream. If one of ours runs away, the process that dies should
# be ours, not the firmware.
#
# OOMScoreAdjust makes the kernel and earlyoom prefer our processes as the
# victim, and the analysis jobs inherit it from the server. MemoryMax caps
# each service's cgroup where the kernel supports it; the caps sit well
# above normal use (about 190 MB for the server, 135 MB for the stream), so
# they only matter to a runaway. systemd ignores a setting it cannot apply
# rather than failing the unit.
#
# Run as root. Safe to re-run. Limits apply the next time each service starts.
# To undo: rm the two drop-ins below, then systemctl daemon-reload.

set -euo pipefail

SYSTEMD_DIR="${NIGHTSTAND_SYSTEMD_DIR:-/etc/systemd/system}"

write_dropin() {
  local unit="$1" memory_max="$2"
  local dir="${SYSTEMD_DIR}/${unit}.d"
  mkdir -p "$dir"
  cat > "${dir}/10-nightstand-limits.conf" <<EOF
# Managed by scripts/setup_resource_limits.sh. See that script for why.
[Service]
MemoryAccounting=yes
MemoryMax=${memory_max}
OOMScoreAdjust=300
EOF
}

write_dropin free-sleep.service 1200M
write_dropin free-sleep-stream.service 512M

systemctl daemon-reload
