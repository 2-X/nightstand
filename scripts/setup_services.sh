#!/bin/bash
# Installs the systemd units and sudoers rules for updates, rollback,
# switching to upstream free-sleep, reboot, and biometrics controls.
# Shared by install.sh, update.sh, and the fork-switch and agent installers
# so every install path sets up the same controls. Idempotent.
#
# Usage: setup_services.sh [repo_dir]   (run as root, default /home/dac/free-sleep)
# Exits non-zero if any piece could not be installed; callers treat that as a
# warning, since a pod without these still controls the bed.
#
# The rollback and revert units are on-demand oneshots. This only installs
# them; starting either one runs the action. The health and network watchdog
# timers are the units this starts.
set -u

REPO_DIR="${1:-/home/dac/free-sleep}"
USERNAME=dac
SYSTEMD_DIR="${NIGHTSTAND_SYSTEMD_DIR:-/etc/systemd/system}"
SUDOERS_FILE="${NIGHTSTAND_SUDOERS_FILE:-/etc/sudoers.d/$USERNAME}"
STATUS=0

warn() { echo "WARNING: $*"; STATUS=1; }

# Units exec these directly on older installs, and a missing exec bit fails a
# unit with 203/EXEC before it can log anything.
for script in update.sh update_service.sh rollback_pod.sh revert-to-stock.sh; do
  [ -f "$REPO_DIR/scripts/$script" ] && chmod 755 "$REPO_DIR/scripts/$script"
done

cat > "$SYSTEMD_DIR/free-sleep-update.service" <<EOF || warn "could not write free-sleep-update.service"
[Unit]
Description=Nightstand Updater
After=free-sleep.service

[Service]
Type=oneshot
# Run via bash so the updater still works if the script's exec bit is lost
# (systemd fails with 203/EXEC before writing anything to the log otherwise).
ExecStart=/bin/bash /home/dac/free-sleep/scripts/update_service.sh
# Closes the download window even when the updater was killed outright.
ExecStopPost=-/bin/bash /home/dac/free-sleep/scripts/close_update_window.sh
User=root
Group=root
KillMode=process
# Also capture logs at the unit level (append so your file grows)
StandardOutput=append:/persistent/free-sleep-data/logs/free-sleep-update.log
StandardError=append:/persistent/free-sleep-data/logs/free-sleep-update.log

EOF

for unit in free-sleep-rollback.service free-sleep-revert.service; do
  cp "$REPO_DIR/scripts/systemd/$unit" "$SYSTEMD_DIR/" || warn "could not install $unit"
done

# The health check restarts a server that is running but not answering. The
# agent overlay does not carry it, so a tree without the script skips it.
HEALTH=no
if [ -f "$REPO_DIR/scripts/health_check.sh" ]; then
  HEALTH=yes
  for unit in free-sleep-health.service free-sleep-health.timer; do
    cp "$REPO_DIR/scripts/systemd/$unit" "$SYSTEMD_DIR/" || { warn "could not install $unit"; HEALTH=no; }
  done
fi

# The network watchdog restarts the Pod when its Wi-Fi driver has died.
NETWATCH=no
if [ -f "$REPO_DIR/scripts/network_watchdog.sh" ]; then
  NETWATCH=yes
  for unit in free-sleep-network-watchdog.service free-sleep-network-watchdog.timer; do
    cp "$REPO_DIR/scripts/systemd/$unit" "$SYSTEMD_DIR/" || { warn "could not install $unit"; NETWATCH=no; }
  done
fi

systemctl daemon-reload || warn "systemctl daemon-reload failed"
if [ "$HEALTH" = yes ]; then
  systemctl enable --now free-sleep-health.timer >/dev/null 2>&1 || warn "could not start free-sleep-health.timer"
fi
if [ "$NETWATCH" = yes ]; then
  systemctl enable --now free-sleep-network-watchdog.timer >/dev/null 2>&1 || warn "could not start free-sleep-network-watchdog.timer"
fi

RULES=(
  "$USERNAME ALL=(ALL) NOPASSWD: /sbin/reboot"
  "$USERNAME ALL=(root) NOPASSWD: /bin/systemctl start free-sleep-update.service --no-block"
  "$USERNAME ALL=(root) NOPASSWD: /bin/systemctl start free-sleep-rollback.service --no-block"
  "$USERNAME ALL=(root) NOPASSWD: /bin/systemctl start free-sleep-revert.service --no-block"
  "$USERNAME ALL=(ALL) NOPASSWD: /bin/sh /home/dac/free-sleep/scripts/enable_biometrics.sh"
  "$USERNAME ALL=(ALL) NOPASSWD: /bin/sh /home/dac/free-sleep/scripts/disable_biometrics.sh"
  # The app's Biometrics switch turns the stream on with exactly this command.
  "$USERNAME ALL=(root) NOPASSWD: /bin/systemctl enable --now free-sleep-stream.service"
)

# Build the new file beside the old one and check it before it goes live: a
# sudoers file with a syntax error disables sudo for every rule in it.
CANDIDATE=$(mktemp)
[ -f "$SUDOERS_FILE" ] && cat "$SUDOERS_FILE" > "$CANDIDATE"
CHANGED=no
for rule in "${RULES[@]}"; do
  if ! grep -Fxq "$rule" "$CANDIDATE"; then
    echo "$rule" >> "$CANDIDATE"
    CHANGED=yes
  fi
done

if [ "$CHANGED" = yes ]; then
  if command -v visudo >/dev/null 2>&1 && ! visudo -cf "$CANDIDATE" >/dev/null; then
    warn "the updated sudoers rules failed visudo's check; $SUDOERS_FILE was left as it was"
  elif ! install -m 440 "$CANDIDATE" "$SUDOERS_FILE"; then
    warn "could not write $SUDOERS_FILE"
  else
    echo "Sudoers rules for '$USERNAME' updated."
  fi
else
  echo "Sudoers rules for '$USERNAME' already present."
fi
rm -f "$CANDIDATE"

exit "$STATUS"
