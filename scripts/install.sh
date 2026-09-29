#!/bin/bash
# Exit immediately on error, on undefined variables, and on error in pipelines
set -euo pipefail

# --------------------------------------------------------------------------------
# Variables
# main only moves at a release, so its tip is always the newest release.
REPO_URL="https://github.com/LTimothy/nightstand/archive/refs/heads/main.zip"
ZIP_FILE="free-sleep.zip"
UNZIP_DIR="free-sleep-unzip"
REPO_DIR="/home/dac/free-sleep"
SERVER_DIR="$REPO_DIR/server"
USERNAME="dac"

# --------------------------------------------------------------------------------
# Download the repository
echo "Downloading the repository..."
curl -fL -o "$ZIP_FILE" "$REPO_URL"

echo ""
echo "Unzipping the repository..."
rm -rf "$UNZIP_DIR"
unzip -o -q "$ZIP_FILE" -d "$UNZIP_DIR"
echo "Removing the zip file..."
rm -f "$ZIP_FILE"

# Clean up existing directory and move new code into place
echo "Setting up the installation directory..."
# GitHub names the archive's top dir after the repo and ref, so resolve it
# rather than hardcoding it.
SRC_DIR=$(find "$UNZIP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n1)
[ -d "$SRC_DIR" ] || { echo "unexpected zip layout"; exit 1; }
# Stop both database writers before replacing any files. Missing units are
# normal on a first install; a failed stop for an existing unit is fatal.
# Restart services on any refusal after stopping writers, including set -e exits.
STOPPED_SERVICES=()
restart_on_failure() {
  result=$?
  if [ "$result" -ne 0 ] && [ "${#STOPPED_SERVICES[@]}" -gt 0 ]; then
    for stopped_service in "${STOPPED_SERVICES[@]}"; do
      systemctl start "$stopped_service" || true
    done
  fi
}
trap restart_on_failure EXIT
biometrics_enabled="false"
if systemctl is-active --quiet free-sleep-stream; then
  biometrics_enabled="true"
fi
for service in free-sleep free-sleep-stream; do
  if systemctl cat "$service" >/dev/null 2>&1; then
    if [ "$service" = free-sleep ] || [ "$biometrics_enabled" = true ]; then
      STOPPED_SERVICES+=("$service")
    fi
    systemctl stop "$service"
  fi
done
SRC="/persistent/free-sleep-data/free-sleep.db"
if [ -f "$SRC" ]; then
  python3 "$SRC_DIR/scripts/sqlite-safety.py" checkpoint "$SRC"
  mkdir -p /persistent/free-sleep-database-backups
  DEST="/persistent/free-sleep-database-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$-install.db"
  python3 "$SRC_DIR/scripts/sqlite-safety.py" backup "$SRC" "$DEST"
  echo "Database backup saved to $DEST"
fi
rm -rf "$REPO_DIR"
mv "$SRC_DIR" "$REPO_DIR"
rm -rf "$UNZIP_DIR"

chown -R "$USERNAME":"$USERNAME" "$REPO_DIR"

# --------------------------------------------------------------------------------
# Install or update Volta + Node (shared with the fork-switch tool's
# pod-installer.sh, see scripts/ensure-node.sh)
bash "$REPO_DIR/scripts/ensure-node.sh" "$USERNAME"

# --------------------------------------------------------------------------------
# Setup /persistent/free-sleep-data (migrate old configs, logs, etc.)
mkdir -p /persistent/free-sleep-data/logs/
mkdir -p /persistent/free-sleep-data/lowdb/

SRC_FILE="/opt/eight/bin/frank.sh"
DEST_FILE="/persistent/free-sleep-data/dac_sock_path.txt"

if [ -f "$DEST_FILE" ]; then
  echo "Destination file $DEST_FILE already exists, skipping copy."
else
  if [ -r "$SRC_FILE" ]; then
    echo "Found $SRC_FILE, searching for dac.sock path..."
    result=$(grep -oP '(?<=DAC_SOCKET=)[^ ]*dac\.sock' "$SRC_FILE" || true)
    if [ -n "$result" ]; then
      echo "$result" > "$DEST_FILE"
      echo "DAC socket path saved to $DEST_FILE"
    else
      echo "No dac.sock path found in $SRC_FILE, skipping write."
    fi
  else
    echo "File $SRC_FILE not found or not readable, skipping."
  fi
fi


# DO NOT REMOVE, OLD VERSIONS WILL LOSE settings & schedules
FILES_TO_MOVE=(
  "/home/dac/free-sleep-database/settingsDB.json:/persistent/free-sleep-data/lowdb/settingsDB.json"
  "/home/dac/free-sleep-database/schedulesDB.json:/persistent/free-sleep-data/lowdb/schedulesDB.json"
  "/home/dac/dac_sock_path.txt:/persistent/free-sleep-data/dac_sock_path.txt"
)

for entry in "${FILES_TO_MOVE[@]}"; do
  IFS=":" read -r SOURCE_FILE DESTINATION <<< "$entry"
  if [ -f "$SOURCE_FILE" ]; then
    mv "$SOURCE_FILE" "$DESTINATION"
    echo "Moved $SOURCE_FILE to $DESTINATION"
  fi
done

if [ -d /persistent/deviceinfo/ ]; then
  chown -R "$USERNAME":"$USERNAME" /persistent/deviceinfo/
fi

if [ -d /deviceinfo/ ]; then
  chown -R "$USERNAME":"$USERNAME" /deviceinfo/
fi

# Change ownership and permissions
chown -R "$USERNAME":"$USERNAME" /persistent/free-sleep-data/
chmod 770 /persistent/free-sleep-data/
chmod g+s /persistent/free-sleep-data/

# --------------------------------------------------------------------------------
# Install server dependencies

BACKUP_PATH="/home/dac/free-sleep-backup/server/package-lock.json"
NEW_PATH="/home/dac/free-sleep/server/package-lock.json"
NODE_MODULES_BACKUP="/home/dac/free-sleep-backup/server/node_modules"
NODE_MODULES_NEW="/home/dac/free-sleep/server/node_modules"

echo "Reviewing npm dependencies for changes..."
if [ -f "$BACKUP_PATH" ] && [ -f "$NEW_PATH" ]; then
  BACKUP_HASH=$(sha256sum "$BACKUP_PATH" | awk '{print $1}')
  NEW_HASH=$(sha256sum "$NEW_PATH" | awk '{print $1}')

  echo "Backup hash: $BACKUP_HASH"
  echo "New hash: $NEW_HASH"

  if [ "$BACKUP_HASH" != "$NEW_HASH" ]; then
    echo "package-lock.json changed, running npm install..."
    sudo -u "$USERNAME" bash -c "cd '$SERVER_DIR' && /home/$USERNAME/.volta/bin/npm install"
  else
    echo "package-lock.json unchanged, restoring node_modules from backup..."
    if [ -d "$NODE_MODULES_BACKUP" ]; then
      mv "$NODE_MODULES_BACKUP" "$NODE_MODULES_NEW"
      chown -R "$USERNAME:$USERNAME" "$NODE_MODULES_NEW" || true
      echo "node_modules restored from backup."
    else
      echo "Backup node_modules not found, running npm install instead..."
      sudo -u "$USERNAME" bash -c "cd '$SERVER_DIR' && /home/$USERNAME/.volta/bin/npm install"
    fi
  fi
else
  echo "One or both package-lock.json files missing, running npm install..."
  sudo -u "$USERNAME" bash -c "cd '$SERVER_DIR' && /home/$USERNAME/.volta/bin/npm install"
fi
echo ""

# --------------------------------------------------------------------------------
# Run Prisma migrations


# The database and its WAL were checkpointed and backed up before the swap.

migration_failed="false"

# migrate deploy only applies the migrations in this tree; generate refreshes
# the client, since node_modules may have been carried over from before.
echo "Running Prisma migrations..."
NPX="/home/$USERNAME/.volta/bin/npx"
if sudo -u "$USERNAME" bash -c "cd '$SERVER_DIR' && '$NPX' dotenv -e .env.pod -- npx prisma migrate deploy && '$NPX' dotenv -e .env.pod -- npx prisma generate"; then
  echo "Prisma migrations completed successfully."
else
  migration_failed="true"
  echo -e "\033[33mWARNING: Prisma migrations failed! \033[0m"
fi


# Restart free-sleep-stream if it was running before
if [ "$biometrics_enabled" = "true" ]; then
  echo "Restarting free-sleep-stream service..."
  systemctl restart free-sleep-stream
fi

echo ""

# --------------------------------------------------------------------------------
# Create systemd service

SERVICE_FILE="/etc/systemd/system/free-sleep.service"

echo "Creating systemd service file at $SERVICE_FILE..."

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Nightstand Server
After=network.target

[Service]
ExecStart=/home/$USERNAME/.volta/bin/npm run start
WorkingDirectory=$SERVER_DIR
Restart=always
User=$USERNAME
Environment=NODE_ENV=production
Environment=VOLTA_HOME=/home/$USERNAME/.volta
Environment=PATH=/home/$USERNAME/.volta/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin

[Install]
WantedBy=multi-user.target
EOF

echo "Reloading systemd daemon and enabling the service..."
systemctl daemon-reload
systemctl enable free-sleep.service
bash "$REPO_DIR/scripts/setup_resource_limits.sh" || echo "WARNING: failed to install service memory limits"

echo "Starting free-sleep.service..."
systemctl start free-sleep.service

echo "Checking free-sleep service status..."
systemctl status free-sleep.service --no-pager || true
echo ""

# -----------------------------------------------------------------------------------------------------
# Install the RAW-archive retention timer
#
# Without this, frankenfirmware truncates piezo/capacitance RAW files after
# ~75 min, so calibration/analyze jobs asking for multi-hour windows find
# almost no data and crash (empty-dataframe IndexError). See
# server/README_SERVER.md for the mechanism. Idempotent: safe to re-run.

echo "Installing RAW-archive retention timer..."
chmod +x "$REPO_DIR/scripts/archive-raw.sh"
cp "$REPO_DIR/scripts/systemd/free-sleep-archive-raw.service" /etc/systemd/system/
cp "$REPO_DIR/scripts/systemd/free-sleep-archive-raw.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now free-sleep-archive-raw.timer
echo ""

# -----------------------------------------------------------------------------------------------------
# Units and sudoers rules for updates, rollback, switching to upstream
# free-sleep, reboot, and biometrics controls (shared with update.sh and
# the migration installers)

echo "Installing the updater, rollback, and revert services and their sudoers rules..."
bash "$REPO_DIR/scripts/setup_services.sh" "$REPO_DIR" \
  || echo -e "\033[33mWARNING: some updater services or sudoers rules could not be installed; see above\033[0m"
echo ""

# --------------------------------------------------------------------------------
# Graceful device time update (optional)

echo "Attempting to update device time from Google..."
# If the curl fails or is blocked, skip with a warning but don't fail the entire script
# https so TLS at least authenticates the server we're asking for the time
if date_string="$(curl -s --head https://google.com | grep '^Date: ' | sed 's/Date: //g')" && [ -n "$date_string" ]; then
  date -s "$date_string" || echo "WARNING: Unable to update system time"
else
  echo -e "\033[0;33mWARNING: Unable to retrieve date from Google... Skipping time update.\033[0m"
fi

echo ""
sh /home/dac/free-sleep/scripts/add_shortcuts.sh

# --------------------------------------------------------------------------------
# Finish
echo "This is your dac.sock path (if it doesn't end in dac.sock, contact support):"
cat /persistent/free-sleep-data/dac_sock_path.txt 2>/dev/null || echo "No dac.sock path found."

echo -e "\033[0;32mInstallation complete! The Nightstand server is running and will start automatically on boot.\033[0m"
echo -e "\033[0;32mSee logs with: journalctl -u free-sleep --no-pager --output=cat\033[0m"

if [ "$migration_failed" = "true" ]; then
  echo -e "\033[33mWARNING: Prisma migrations failed! A backup of your database prior to the migration was saved to ${DEST:-/persistent/free-sleep-database-backups} \033[0m"
fi
