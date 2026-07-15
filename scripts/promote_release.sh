#!/bin/bash
# Promote one release from `beta` to `stable` in releases.json, in place.
#
# Part of the release ritual (see CONTRIBUTING.md "Release cadence and
# promotion"): a release is born on `beta` and promoted only after it has
# soaked on real hardware. This edits exactly one entry's `channel` field and
# leaves everything else byte-for-byte, then prints the matching `gh release
# edit` command so the GitHub Release's prerelease flag can be brought in line.
#
# Usage: scripts/promote_release.sh <version>          # e.g. 3.3.0
#   Refuses an unknown version. No-ops (with a note) if already stable.
#
# This is a maintainer tool run on a laptop, not on the pod.
set -uo pipefail

VERSION="${1:-}"
[ -n "$VERSION" ] || { echo "usage: $0 <version>   (e.g. 3.3.0)" >&2; exit 2; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/releases.json"
[ -f "$MANIFEST" ] || { echo "FATAL: no releases.json at $MANIFEST" >&2; exit 1; }

# Edit in place with python (no jq dependency), preserving order + formatting.
# Prints one of: promoted | already-stable | unknown
RESULT=$(python3 - "$MANIFEST" "$VERSION" <<'PY'
import json, sys
path, target = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
rels = data.get("releases", [])
match = next((r for r in rels if r.get("version") == target), None)
if match is None:
    print("unknown"); sys.exit(0)
if match.get("channel") == "stable":
    print("already-stable"); sys.exit(0)
match["channel"] = "stable"
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
# Is this now the newest stable? (drives gh --latest)
def parts(v): return [int(x) for x in v.split(".")]
stables = [r["version"] for r in rels if r.get("channel") == "stable"]
newest = max(stables, key=parts) if stables else None
print("promoted:newest" if newest == target else "promoted")
PY
)

case "$RESULT" in
  unknown)
    echo "FATAL: v$VERSION is not in releases.json, nothing to promote" >&2; exit 1 ;;
  already-stable)
    echo "v$VERSION is already stable; nothing to do." ; exit 0 ;;
  promoted*)
    echo "Promoted v$VERSION to stable in releases.json."
    GH="gh release edit v$VERSION --prerelease=false"
    [ "$RESULT" = "promoted:newest" ] && GH="$GH --latest"
    echo "Now bring the GitHub Release in line:"
    echo "  $GH"
    ;;
  *)
    echo "FATAL: unexpected result '$RESULT'" >&2; exit 1 ;;
esac
