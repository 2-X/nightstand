#!/bin/bash

BASHRC="$HOME/.bashrc"

# Define your shortcuts here
SHORTCUTS=(
  "alias fs-debug='sh /home/dac/free-sleep/scripts/debug.sh'"
  "alias fs-restart='sh /home/dac/free-sleep/scripts/restart.sh'"
  "alias fs-reset='sh /home/dac/free-sleep/scripts/reset.sh'"
  "alias fs-update='sh /home/dac/free-sleep/scripts/update.sh'"
)

echo "Adding shortcuts to $BASHRC..."

for shortcut in "${SHORTCUTS[@]}"; do
  # Extract alias name for checking duplicates
  name=$(echo "$shortcut" | cut -d'=' -f1 | awk '{print $2}')

  if grep -q "$name" "$BASHRC"; then
    echo "  - Skipping existing shortcut: $name"
  else
    echo "$shortcut" >> "$BASHRC"
    echo "  - Added shortcut: $name"
  fi
done

echo ""
