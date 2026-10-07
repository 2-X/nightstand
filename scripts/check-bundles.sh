#!/bin/bash
# Lists committed bundle files that nothing uses anymore. The app build does
# not empty server/public, and the server build does not delete output for
# removed sources, so old files stay unless they are removed by hand.
# Usage: scripts/check-bundles.sh [repo-root]; exits 1 when it finds any.
set -u
cd "${1:-.}" || exit 2
status=0
for file in $(git ls-files server/public | grep '\.js$'); do
  name=$(basename "$file")
  case "$name" in index.js|mockServiceWorker.js) continue ;; esac
  if ! grep -rqF --exclude="$name" --exclude='*.map' -- "$name" server/public; then
    echo "orphan: $file"
    status=1
  fi
done
for file in $(git ls-files server/dist | grep '\.js$'); do
  source="server/src/${file#server/dist/}"
  source="${source%.js}"
  if [ ! -e "$source.ts" ] && [ ! -e "$source.js" ]; then
    echo "orphan: $file"
    status=1
  fi
done
for file in $(git ls-files server/public server/dist | grep '\.map$'); do
  if ! git ls-files --error-unmatch -- "${file%.map}" >/dev/null 2>&1; then
    echo "orphan: $file"
    status=1
  fi
done
exit $status
