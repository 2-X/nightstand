#!/bin/bash
# Older units and docs run this name. The switch to upstream free-sleep is
# switch-to-upstream.sh; Eight Sleep's own software is restored only by a
# firmware reset (INSTALLATION.md).
exec bash "$(dirname "${BASH_SOURCE[0]}")/switch-to-upstream.sh" "$@"
