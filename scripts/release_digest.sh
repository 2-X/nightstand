#!/bin/bash
# Writes release tree digests into releases.json, which the updater checks a
# downloaded release against before installing it.
#
# Usage:
#   scripts/release_digest.sh             digest of HEAD into the newest entry,
#                                         amending the release commit (run
#                                         after the release commit, before
#                                         tagging)
#   scripts/release_digest.sh --backfill  every entry that has a tag, from its
#                                         tag, left uncommitted
#
# The digest is read from git archive's tar, which matches GitHub's archive
# of the same commit. Any other tree, such as an upstream commit for
# upstreamSwitch, is digested the same way:
#   git -c core.autocrlf=false -c core.eol=lf -c core.attributesFile=/dev/null \
#     archive <commit> | python3 scripts/tree_digest.py --tar -
#
# This is a maintainer tool run on a laptop, not on the pod.
set -euo pipefail
cd "$(dirname "$0")/.."

# GitHub's archive ignores this clone's settings, so they are switched off
# here. Attributes committed in the tree apply to both, but export-subst and
# export-ignore are easy to get wrong, so a tree with any is refused.
digest_of() {
  local attributes
  attributes=$(git ls-tree -r --name-only "$1" | grep -E '(^|/)\.gitattributes$' || true)
  if [ -n "$attributes" ]; then
    echo "$1 has $attributes; check that its archive matches GitHub's before publishing a checksum" >&2
    return 1
  fi
  git -c core.autocrlf=false -c core.eol=lf -c core.attributesFile=/dev/null archive "$1" \
    | python3 scripts/tree_digest.py --tar -
}

# Sets one entry's treeSha256, keeping the file's formatting and key order.
write() {
  python3 - "$1" "$2" <<'PY'
import json, re, sys
version, digest = sys.argv[1], sys.argv[2]
if not re.fullmatch(r"[0-9a-f]{64}", digest):
    sys.exit("refusing to write %r as the checksum of v%s" % (digest, version))
with open("releases.json") as handle:
    data = json.load(handle)
matches = [release for release in data["releases"] if release["version"] == version]
if len(matches) != 1:
    sys.exit("v%s is not in releases.json exactly once" % version)
matches[0]["treeSha256"] = digest
with open("releases.json", "w") as handle:
    json.dump(data, handle, indent=2)
    handle.write("\n")
PY
}

if [ "${1:-}" = --backfill ]; then
  for version in $(python3 -c 'import json; print(" ".join(r["version"] for r in json.load(open("releases.json"))["releases"]))'); do
    git rev-parse -q --verify "refs/tags/v$version" >/dev/null || { echo "skip v$version (no tag)"; continue; }
    DIGEST=$(digest_of "v$version")
    write "$version" "$DIGEST"
    echo "v$version done"
  done
  exit 0
fi

[ "$#" -eq 0 ] || { echo "usage: $0 [--backfill]" >&2; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "commit everything first" >&2; exit 1; }
VERSION=$(python3 -c 'import json; print(json.load(open("releases.json"))["releases"][0]["version"])')
BUILT=$(python3 -c 'import json; print(json.load(open("server/src/serverInfo.json"))["version"])')
[ "$BUILT" = "$VERSION" ] || {
  echo "serverInfo.json says $BUILT but the newest release is $VERSION; run this on the release commit" >&2
  exit 1
}
DIGEST=$(digest_of HEAD)
write "$VERSION" "$DIGEST"
git commit --amend --no-edit --quiet releases.json
echo "treeSha256 written for v$VERSION"
