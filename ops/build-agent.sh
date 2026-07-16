#!/bin/bash
# Generates the agent overlay: stock upstream at the pinned base, plus the
# files named in server/src/agent/agentManifest.ts, and nothing else.
#
# The agent's claim is that it adds update, rollback and revert to a stock
# install and changes nothing else. Stock ships no tests, so the evidence this
# script produces is that the app still builds against stock, the server
# typechecks, and the agent's own tests pass. Behavioral identity is not
# proven here; that needs a real pod.
#
# Usage: ops/build-agent.sh [--out DIR] [--skip-validate]
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT="/tmp/nightstand-agent-build/tree"
VALIDATE=yes

say() { echo "[build-agent] $*"; }
fail() { echo "" >&2; echo "FAILED: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --skip-validate) VALIDATE=no; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

[ -n "$OUT" ] || fail "--out must not be empty"
[ "$OUT" != "/" ] || fail "--out must not be /"

# Read the manifest through node so the shell never carries a second copy of
# the file list. A drifting duplicate is worse than no list at all.
read_manifest() {
  node --experimental-strip-types -e "
    import('$REPO_ROOT/server/src/agent/agentManifest.ts').then((m) => {
      if (process.argv[1] === 'base') { console.log(m.AGENT_BASE.sha); return; }
      if (process.argv[1] === 'count') { console.log(m.AGENT_MANIFEST.length); return; }
      for (const e of m.AGENT_MANIFEST) console.log(e.mode + ' ' + e.path);
    });
  " -- "$1"
}

BASE_SHA=$(read_manifest base)
[ -n "$BASE_SHA" ] || fail "could not read AGENT_BASE.sha from the manifest"
say "base sha: $BASE_SHA"

# Export stock at the pinned base. The base is a sha on purpose: upstream
# publishes no tags, so its version string identifies nothing.
git -C "$REPO_ROOT" cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null \
  || fail "base $BASE_SHA is not in this clone. Run: git fetch upstream"

rm -rf "$OUT"
mkdir -p "$OUT"
git -C "$REPO_ROOT" archive "$BASE_SHA" | tar -x -C "$OUT"
say "exported stock into $OUT"

MANIFEST_ENTRIES=$(read_manifest entries)
MANIFEST_LEN=$(read_manifest count)
[ -n "$MANIFEST_LEN" ] || fail "could not read AGENT_MANIFEST.length from the manifest"

ADDED=0; COPIED=0; PATCHED=0
while read -r MODE REL; do
  [ -n "$REL" ] || continue
  SRC="$REPO_ROOT/$REL"
  DST="$OUT/$REL"
  [ -f "$SRC" ] || fail "$REL is in the manifest but missing from this repo"

  case "$MODE" in
    add)
      [ -e "$DST" ] && fail "$REL is declared 'add' but already exists in stock at this base. The base changed; reclassify it."
      mkdir -p "$(dirname "$DST")"
      cp -p "$SRC" "$DST"
      ADDED=$((ADDED+1))
      ;;
    copy)
      [ -e "$DST" ] || fail "$REL is declared 'copy' but does not exist in stock at this base. The base changed; reclassify it."
      # -p because cp onto an existing file keeps the destination's mode, and
      # stock commits its shell scripts without the exec bit while this tree
      # commits them with it. A script that lands at 0644 dies with 203/EXEC
      # when its systemd unit ExecStarts it, which no typecheck would catch.
      cp -p "$SRC" "$DST"
      COPIED=$((COPIED+1))
      ;;
    patch)
      [ -e "$DST" ] || fail "$REL is declared 'patch' but does not exist in stock at this base."
      PATCHED=$((PATCHED+1))
      ;;
    *) fail "unknown mode '$MODE' for $REL" ;;
  esac
done <<< "$MANIFEST_ENTRIES"

TOTAL_ENTRIES=$((ADDED + COPIED + PATCHED))
[ "$TOTAL_ENTRIES" -eq "$MANIFEST_LEN" ] \
  || fail "processed $TOTAL_ENTRIES manifest entries but AGENT_MANIFEST declares $MANIFEST_LEN; some entries were skipped"
say "added $ADDED, copied $COPIED, patching $PATCHED (of $MANIFEST_LEN manifest entries)"

# Patch 1: register the update route. Stock's routes.ts aggregates every route
# in the tree, so this repo's copy imports a dozen routes stock does not have.
# Two lines is the whole difference.
ROUTES="$OUT/server/src/setup/routes.ts"
if grep -q "routes/update/update.js" "$ROUTES"; then
  fail "stock's routes.ts already imports the update route at this base; the patch is obsolete"
fi
perl -0pi -e "s{(import logger from '\.\./logger\.js';)}{import update from '../routes/update/update.js';\n\$1}" "$ROUTES"
perl -0pi -e "s{(\n\s*app\.use\('/api/', settings\);)}{\$1\n  app.use('/api/', update);}" "$ROUTES"
grep -q "routes/update/update.js" "$ROUTES" \
  || fail "routes.ts import patch did not apply. Stock's routes.ts changed at this base; it needs a human."
grep -q "app.use('/api/', update);" "$ROUTES" \
  || fail "routes.ts registration patch did not apply. Stock's routes.ts changed at this base; it needs a human."
say "patched routes.ts"

# Patch 2: the one script entry the agent needs. The agent carries the first
# three test files this project has ever had, and stock has no test runner
# entry to run them with, so the agent brings that too. Stock already has
# ts-node and typescript, which the script needs. Read the value from this
# repo rather than hardcoding it, so the patch cannot drift from its source.
TEST_SCRIPT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$REPO_ROOT/server/package.json','utf8')).scripts['test'] || '')")
[ -n "$TEST_SCRIPT" ] || fail "server/package.json has no 'test' script to carry over; the manifest's patch entry is stale"
node -e "
  const fs = require('fs');
  const p = '$OUT/server/package.json';
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (pkg.scripts && pkg.scripts.test) {
    console.error('stock already has a test script at this base; the patch is obsolete');
    process.exit(1);
  }
  pkg.scripts = pkg.scripts || {};
  pkg.scripts.test = process.argv[1];
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
" -- "$TEST_SCRIPT" || fail "package.json patch failed"
say "patched package.json"

# The contract cuts both ways, and the reverse direction has no other check.
# STOCK_CONTRACT names what agent files may import from stock; nothing has ever
# confirmed those paths are really there, because until now no stock tree was
# on disk to look at. Confirm it here, where one is.
STOCK_CONTRACT_PATHS=$(node --experimental-strip-types -e "
  import('$REPO_ROOT/server/src/agent/agentManifest.ts').then((m) => {
    for (const p of m.STOCK_CONTRACT.paths) console.log(p);
  });
")
STOCK_CONTRACT_COUNT=$(node --experimental-strip-types -e "
  import('$REPO_ROOT/server/src/agent/agentManifest.ts').then((m) => {
    console.log(m.STOCK_CONTRACT.paths.length);
  });
")
[ -n "$STOCK_CONTRACT_PATHS" ] || fail "STOCK_CONTRACT.paths came back empty; the manifest import failed or the list is empty"
FOUND_COUNT=$(printf '%s\n' "$STOCK_CONTRACT_PATHS" | grep -c .)
[ "$FOUND_COUNT" -eq "$STOCK_CONTRACT_COUNT" ] \
  || fail "read $FOUND_COUNT STOCK_CONTRACT paths but the manifest declares $STOCK_CONTRACT_COUNT; the node call likely failed partway"
while read -r REL; do
  [ -n "$REL" ] || continue
  [ -e "$OUT/$REL" ] || fail "STOCK_CONTRACT names $REL, but stock at this base does not have it"
done <<< "$STOCK_CONTRACT_PATHS"
say "stock contract: all $STOCK_CONTRACT_COUNT paths present in stock"

# serverInfo.json is mode 'copy': the agent overwrites stock's wholesale, and
# stock's own code reads that file, so the overlay owes stock's readers the keys
# they expect. Adding keys is safe; dropping one is not. Read stock's version
# from git rather than from the tree, which the copy has already replaced.
STOCK_SERVERINFO=$(mktemp)
trap 'rm -f "$STOCK_SERVERINFO"' EXIT
git -C "$REPO_ROOT" show "$BASE_SHA:server/src/serverInfo.json" > "$STOCK_SERVERINFO" \
  || fail "could not read stock's serverInfo.json at this base"
node -e "
  const fs = require('fs');
  const stock = JSON.parse(fs.readFileSync('$STOCK_SERVERINFO', 'utf8'));
  const agent = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const dropped = Object.keys(stock).filter((k) => !(k in agent));
  if (dropped.length) {
    console.error('the agent serverInfo.json drops keys stock readers expect: ' + dropped.join(', '));
    process.exit(1);
  }
  console.log('[build-agent] serverInfo.json keeps every key stock readers expect');
" "$REPO_ROOT/server/src/serverInfo.json" || fail "the agent's serverInfo.json is not compatible with stock's readers"

say "generated tree written to $OUT"

if [ "$VALIDATE" = no ]; then
  say "skipping validation (--skip-validate)"
  exit 0
fi

# What actually proves the overlay. Note stock ships ZERO test files, so there
# is no inherited suite to lean on: the real evidence is that the app compiles
# against stock, and the tree differs only where the manifest says it does.
# The three tests below are the agent's own, carried in by the overlay.
# Install the server's dependencies first. The app's tsc -b reaches across the
# package boundary into the server's zod schemas, so without server/node_modules
# the app build fails on stock's own files, not the agent's: zod goes unresolved,
# the schema types collapse, and the errors cascade into files the overlay never
# touches. Stock at this base builds clean once both halves are installed.
say "installing dependencies (server first; the app build reads its schemas)"
( cd "$OUT/server" && npm ci --silent ) || fail "server npm ci failed"
( cd "$OUT/app" && npm ci --silent ) || fail "app npm ci failed"

say "validating: app build (the real check that agent files compile on stock)"
( cd "$OUT/app" && npm run build:pr ) || fail "the app does not build with the agent on top; an agent file reaches for something stock does not have"

say "validating: server typecheck and the agent's own tests"
( cd "$OUT/server" && npx tsc --noEmit ) || fail "server typecheck failed on the generated tree"

# npm test exits 0 when the glob matches zero files, so a passing exit code
# alone proves nothing. Pull the pass/fail counts out of the test runner's own
# summary line instead; the reporter differs by Node version (TAP's "# pass N"
# vs the spec reporter's "info pass N"), so match on the trailing "pass N" /
# "fail N" tokens rather than a fixed prefix.
TEST_OUTPUT=$(cd "$OUT/server" && npm test 2>&1) \
  || { printf '%s\n' "$TEST_OUTPUT" >&2; fail "the agent's own tests do not pass on the generated tree"; }
PASS_LINE=$(printf '%s\n' "$TEST_OUTPUT" | grep -E '(^|[^[:alpha:]])pass [0-9]+$' | tail -1)
FAIL_LINE=$(printf '%s\n' "$TEST_OUTPUT" | grep -E '(^|[^[:alpha:]])fail [0-9]+$' | tail -1)
if [ -z "$PASS_LINE" ] || [ -z "$FAIL_LINE" ]; then
  printf '%s\n' "$TEST_OUTPUT" >&2
  fail "could not find a pass/fail test count in npm test's output; the reporter format may have changed"
fi
PASS_COUNT=$(printf '%s' "$PASS_LINE" | grep -Eo '[0-9]+$')
FAIL_COUNT=$(printf '%s' "$FAIL_LINE" | grep -Eo '[0-9]+$')
[ "$PASS_COUNT" -gt 0 ] || fail "npm test reported 0 passing tests; the agent's test files may be missing from the manifest or the glob matched nothing"
[ "$FAIL_COUNT" -eq 0 ] || { printf '%s\n' "$TEST_OUTPUT" >&2; fail "npm test reported $FAIL_COUNT failing tests"; }
say "OK: app builds on stock, server typechecks, $PASS_COUNT agent tests pass"
