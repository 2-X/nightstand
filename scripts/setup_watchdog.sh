#!/bin/bash
#
# Enable the hardware watchdog so a wedged kernel cannot strand the pod.
#
# Background: the stock Wi-Fi driver hit a kernel oops, processes wedged in
# uninterruptible sleep, and the nightly reboot hung with PID 1 frozen. systemd arms its reboot watchdog only at the final reboot handoff,
# which that shutdown never reached, so nothing reset the board and the pod sat
# with no server and no cooling until it was power cycled by hand.
#
# RuntimeWatchdogSec is the layer that was missing. PID 1 pets /dev/watchdog at
# half the timeout, so a frozen kernel or a frozen PID 1 hard-resets the SoC.
#
# Run once as root on the pod. Safe to re-run.
# To undo: rm the drop-in below, then systemctl daemon-reexec.

set -euo pipefail

DROPIN_DIR="/etc/systemd/system.conf.d"
DROPIN="${DROPIN_DIR}/10-nightstand-watchdog.conf"

# mtk-wdt reports a 31s hardware maximum, so the runtime timer stays inside it.
# The reboot timer may exceed it because the watchdog core extends longer
# timeouts in software.
RUNTIME_TIMEOUT="${NIGHTSTAND_WATCHDOG_RUNTIME:-30s}"
REBOOT_TIMEOUT="${NIGHTSTAND_WATCHDOG_REBOOT:-60s}"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must run as root." >&2
  exit 1
fi

if [ ! -e /dev/watchdog ]; then
  echo "No /dev/watchdog on this device. Refusing to configure a watchdog that cannot arm." >&2
  exit 1
fi

echo "Writing ${DROPIN}..."
mkdir -p "${DROPIN_DIR}"
cat > "${DROPIN}" <<EOF
# Managed by scripts/setup_watchdog.sh. See that script for why this exists.
[Manager]
RuntimeWatchdogSec=${RUNTIME_TIMEOUT}
RebootWatchdogSec=${REBOOT_TIMEOUT}
EOF

echo "Re-executing systemd to apply it (running services are not restarted)..."
systemctl daemon-reexec
sleep 3

# Verify rather than assume. An unverified assumption that the watchdog was
# active is what made the outage above last eight hours instead of thirty
# seconds, so this script fails loudly if the device did not actually arm.
runtime_effective="$(systemctl show -p RuntimeWatchdogUSec --value || true)"
reboot_effective="$(systemctl show -p RebootWatchdogUSec --value || true)"
echo "Verifying..."
echo "  RuntimeWatchdogUSec=${runtime_effective}"
echo "  RebootWatchdogUSec=${reboot_effective}"

if [ -z "${runtime_effective}" ] || [ "${runtime_effective}" = "0" ]; then
  echo "FAILED: the runtime watchdog is still disabled." >&2
  exit 1
fi

if ls -l /proc/1/fd 2>/dev/null | grep -q watchdog; then
  echo "OK: PID 1 holds the watchdog device."
else
  echo "FAILED: PID 1 did not open a watchdog device, so the watchdog is NOT active." >&2
  exit 1
fi

echo
echo "Done. A frozen kernel or PID 1 now hard-resets the pod within ${RUNTIME_TIMEOUT}."
