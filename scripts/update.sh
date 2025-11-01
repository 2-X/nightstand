#!/bin/bash

# Save output to /persistent/free-sleep-data/logs/free-sleep-update.log
echo -e "\033[33mWARNING: Logs are saved to /persistent/free-sleep-data/logs/free-sleep-update.log\033[0m"
LOG_FILE="/persistent/free-sleep-data/logs/free-sleep-update.log"
exec >>"$LOG_FILE" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') Starting update.sh ==="

export PATH="/usr/sbin:/sbin:/usr/bin:/bin"

# Optional: Exit immediately on error
set -e

# Name of the backup folder with a timestamp
BACKUP_NAME="free-sleep-backup-$(date +%Y%m%d%H%M%S)"

systemctl stop free-sleep
systemctl disable free-sleep

# Unblock internet first
sh /home/dac/free-sleep/scripts/unblock_internet_access.sh

# If a free-sleep folder exists, back it up
if [ -d /home/dac/free-sleep ]; then
  echo "Backing up current free-sleep to /home/dac/$BACKUP_NAME"
  mv /home/dac/free-sleep /home/dac/$BACKUP_NAME
fi

echo "Attempting to reinstall free-sleep..."
if /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/throwaway31265/free-sleep/main/scripts/install.sh)"; then
  echo "Reinstall successful."
   rm -rf "/home/dac/$BACKUP_NAME"
else
  echo "Reinstall failed. Restoring from backup..."
  rm -rf /home/dac/free-sleep
  mv "/home/dac/$BACKUP_NAME" /home/dac/free-sleep
  systemctl enable free-sleep
  systemctl start free-sleep
fi

# Block internet access again
sh /home/dac/free-sleep/scripts/block_internet_access.sh
echo -e "\033[0;32mUpdate completed successfully!\033[0m"
echo -e "\033[0;32mRestart your pod with 'reboot -h now'\033[0m"
