#!/bin/bash
# Ensures Volta + Node are installed for a user. Shared by scripts/install.sh
# (fresh installs) and scripts/migrate/pod-installer.sh (fork-switch tool,
# migrating an install that may predate Volta entirely) so this bootstrap
# logic lives in exactly one place.
#
# Usage: ensure-node.sh <username>
set -euo pipefail

USERNAME="${1:?usage: ensure-node.sh <username>}"

if [ -d "/home/$USERNAME/.volta" ]; then
  echo "Volta is already installed for user '$USERNAME'."
else
  echo "Volta is not installed. Installing for user '$USERNAME'..."
  sudo -u "$USERNAME" bash -c 'curl https://get.volta.sh | bash'
  if ! grep -q 'export VOLTA_HOME=' "/home/$USERNAME/.profile"; then
    echo -e '\nexport VOLTA_HOME="/home/dac/.volta"\nexport PATH="$VOLTA_HOME/bin:$PATH"\n' \
      >> "/home/$USERNAME/.profile"
  fi
  echo "Finished installing Volta"
fi

echo "Installing/ensuring Node 24.11.0 via Volta..."
sudo -u "$USERNAME" bash -c "source /home/$USERNAME/.profile && volta install node@24.11.0"
