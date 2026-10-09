#!/bin/bash
# Reconcile configuration under the caller's maintenance operation lock.
set -euo pipefail
exec python3 -B "$(dirname "$0")/switch_services.py" "$@"
