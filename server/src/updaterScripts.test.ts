import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The pod's self-updater is bash, so it can't be unit-tested here, but a
// syntax error or a wrong URL would brick the update path. Gate the cheap,
// high-signal invariants: the scripts parse, they point at this fork, and
// the safety rails (rollback, WAN re-block) are present.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = ['scripts/update.sh', 'scripts/update_service.sh'];

describe('updater shell scripts', () => {
  for (const script of SCRIPTS) {
    it(`${script} exists and parses (bash -n)`, () => {
      const full = path.join(repoRoot, script);
      assert.equal(existsSync(full), true, `${script} is missing`);
      assert.doesNotThrow(() => execFileSync('bash', ['-n', full]));
    });
  }

  it('update.sh pulls from this fork and keeps its safety rails', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/update.sh'), 'utf8');
    assert.match(src, /github\.com\/LTimothy\/nightstand\/archive\/refs\/heads\/main\.zip/);
    assert.match(src, /raw\.githubusercontent\.com\/LTimothy\/nightstand\/main\/server\/src\/serverInfo\.json/);
    assert.match(src, /block_internet_access\.sh/, 'must re-block WAN');
    assert.match(src, /trap cleanup EXIT/, 'must re-block WAN even on failure');
    assert.match(src, /rolling back/i, 'must have a rollback path');
    assert.match(src, /server\/dist\/server\.js/, 'must verify the staged build output');
    // The archive's top dir is named after the repo, so it must be resolved
    // dynamically, never hardcoded to a repo name that a rename would break.
    assert.doesNotMatch(src, /free-sleep-main|nightstand-main/, 'must not hardcode the archive dir name');
    assert.match(src, /find "\$STAGE\.unzip".*-type d/, 'must resolve the staged archive dir dynamically');
  });

  // free-sleep-update.service ExecStarts update_service.sh, which runs
  // update.sh. If either loses its exec bit the unit dies with 203/EXEC
  // before writing a single log line.
  for (const script of SCRIPTS) {
    it(`${script} is executable`, () => {
      const mode = statSync(path.join(repoRoot, script)).mode;
      assert.ok(mode & 0o111, `${script} must carry the exec bit`);
    });
  }
});
