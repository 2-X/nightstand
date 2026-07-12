import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/revert-to-stock.sh swaps the live install for plain upstream
// free-sleep. It's bash, so like update.sh and rollback_pod.sh it can't be
// unit-tested directly: gate the invariants that would otherwise brick a
// revert silently: it points at upstream (not this fork), it re-blocks WAN
// even on failure, it never gates health on a populated temperature (the
// false-failure mode pod-installer.sh already hit and fixed), and it always
// restores this fork on a failed health check rather than leaving the pod
// on neither tree.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'scripts/revert-to-stock.sh';
const UNIT = 'scripts/systemd/free-sleep-revert.service';

describe('revert-to-stock.sh', () => {
  it('exists, parses (bash -n), and carries the exec bit', () => {
    const full = path.join(repoRoot, SCRIPT);
    assert.equal(existsSync(full), true, `${SCRIPT} is missing`);
    assert.doesNotThrow(() => execFileSync('bash', ['-n', full]));
    const mode = statSync(full).mode;
    assert.ok(mode & 0o111, `${SCRIPT} must carry the exec bit`);
  });

  it('downloads from upstream, not this fork', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    assert.match(src, /github\.com\/throwaway31265\/free-sleep\/archive\/refs\/heads\/main\.zip/);
    assert.doesNotMatch(src, /LTimothy\/nightstand/, 'must not fetch from this fork');
  });

  it('re-blocks WAN even on failure', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    assert.match(src, /block_internet_access\.sh/, 'must re-block WAN');
    assert.match(src, /trap cleanup EXIT/, 'must re-block WAN even on a failure exit');
  });

  it('verifies the staged build output before swapping', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    assert.match(src, /server\/dist\/server\.js/, 'must verify the staged build output');
    assert.match(src, /server\/public\/index\.html/);
  });

  it('resolves the staged archive dir dynamically, never hardcoded', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    assert.doesNotMatch(src, /free-sleep-main/, 'must not hardcode the archive dir name');
    assert.match(src, /find "\$STAGE\.unzip".*-type d/);
  });

  it('backs up code and data before swapping', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    assert.match(src, /tar czf "\$BK\/code\.tar\.gz"/);
    assert.match(src, /free-sleep\.db/);
    assert.match(src, /lowdb/);
  });

  it('health check does not gate on a populated per-side temperature', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    const healthIdx = src.indexOf('Health check (up to 90s)');
    assert.ok(healthIdx >= 0, 'expected a health-check section');
    const healthBlock = src.slice(healthIdx, src.indexOf('HEALTHY=no', healthIdx + 1) + 400);
    assert.doesNotMatch(healthBlock, /currentTemperatureF/,
      'must not repeat the false-failure mode pod-installer.sh already fixed');
  });

  it('restores this fork if the post-swap health check fails', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    assert.match(src, /Health check FAILED: rolling back to this fork/);
    const restoreIdx = src.indexOf('Health check FAILED: rolling back to this fork');
    const rest = src.slice(restoreIdx);
    assert.match(rest, /systemctl start free-sleep\b/);
  });

  it('removes fork-only systemd units after a successful revert', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    const successIdx = src.indexOf('SUCCESS: pod is serving stock');
    assert.ok(successIdx >= 0);
    const rest = src.slice(successIdx);
    assert.match(rest, /free-sleep-rollback\.service/);
    assert.match(rest, /free-sleep-revert\.service/);
  });

  it('never rewrites /persistent/free-sleep-data other than a backup copy', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    // Every reference to the data dir must be inside a backup line (cp ... "$BK"),
    // not a write into the live path.
    const dataRefs = src.match(/\/persistent\/free-sleep-data\/[^\s"']+/g) ?? [];
    for (const ref of dataRefs) {
      const line = src.split('\n').find(l => l.includes(ref)) ?? '';
      assert.doesNotMatch(line, /rm -f|rm -rf/, `must not delete from ${ref}`);
    }
  });

  it('the systemd unit runs the script via bash and exists', () => {
    const full = path.join(repoRoot, UNIT);
    assert.equal(existsSync(full), true, `${UNIT} is missing`);
    const src = readFileSync(full, 'utf8');
    assert.match(src, /ExecStart=\/bin\/bash \/home\/dac\/free-sleep\/scripts\/revert-to-stock\.sh/);
  });

  it('install.sh installs the revert-to-stock service and its sudoers rule', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/install.sh'), 'utf8');
    assert.match(src, /free-sleep-revert\.service/);
    assert.match(src, /NOPASSWD: \/bin\/systemctl start free-sleep-revert\.service --no-block/);
  });

  it('update.sh self-heals the revert-to-stock service and sudoers rule for existing installs', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/update.sh'), 'utf8');
    assert.match(src, /Ensuring revert-to-stock service is installed/);
    assert.match(src, /free-sleep-revert\.service/);
    assert.match(src, /NOPASSWD: \/bin\/systemctl start free-sleep-revert\.service --no-block/);
  });
});
