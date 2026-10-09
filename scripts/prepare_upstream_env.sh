#!/bin/bash
# Builds a permanent upstream environment. Live mapping publication is separate.
set -euo pipefail
exec python3 -B "$(dirname "${BASH_SOURCE[0]}")/prepare_upstream_env.py" "$@"
