import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/rollback_pod.sh swaps the
// live install back to the previous tree. It's bash, so like update.sh it
// can't be unit-tested directly: gate the invariants that would otherwise
// brick a rollback silently: it refuses to run against a missing/unreadable
// PREV, it never touches WAN, and it always restores on a failed health
// check rather than leaving the pod on neither tree.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'scripts/rollback_pod.sh';
const UNIT = 'scripts/systemd/free-sleep-rollback.service';

describe('rollback_pod.sh', () => {
  it('exists, parses (bash -n), and carries the exec bit', () => {
    const full = path.join(repoRoot, SCRIPT);
    assert.equal(existsSync(full), true, `${SCRIPT} is missing`);
    assert.doesNotThrow(() => execFileSync('bash', ['-n', full]));
    const mode = statSync(full).mode;
    assert.ok(mode & 0o111, `${SCRIPT} must carry the exec bit`);
  });

  it('refuses to run against a missing or unreadable PREV', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    assert.match(src, /no previous install at \$PREV/);
    assert.match(src, /refusing to swap to an unknown tree/);
  });

  it('never touches WAN (no unblock/block calls)', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    assert.doesNotMatch(src, /unblock_internet_access|block_internet_access/);
  });

  it('restores the running version if the post-swap health check fails', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    assert.match(src, /Health check FAILED: swapping back/);
    // The restore path must re-run the shared node_modules fixup and
    // actually start the service back up, not just log and exit.
    const restoreIdx = src.indexOf('Health check FAILED: swapping back');
    const rest = src.slice(restoreIdx);
    assert.match(rest, /fix_shared_node_modules/);
    assert.match(rest, /systemctl start free-sleep/);
  });

  it('detects and relocates a shared node_modules copy after the swap', () => {
    const src = readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    assert.match(src, /fix_shared_node_modules\s*\(\)\s*{/, 'expected a fix_shared_node_modules helper');
    assert.match(src, /cmp -s "\$LIVE\/server\/package-lock\.json" "\$PREV\/server\/package-lock\.json"/);
  });

  it('the systemd unit runs the script via bash and exists', () => {
    const full = path.join(repoRoot, UNIT);
    assert.equal(existsSync(full), true, `${UNIT} is missing`);
    const src = readFileSync(full, 'utf8');
    assert.match(src, /ExecStart=\/bin\/bash \/home\/dac\/free-sleep\/scripts\/rollback_pod\.sh/);
  });

  it('install.sh installs the rollback service and its sudoers rule', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/install.sh'), 'utf8');
    assert.match(src, /free-sleep-rollback\.service/);
    assert.match(src, /NOPASSWD: \/bin\/systemctl start free-sleep-rollback\.service --no-block/);
  });

  it('update.sh self-heals the rollback service and sudoers rule for older installs', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/update.sh'), 'utf8');
    assert.match(src, /Ensuring instant-rollback service is installed/);
    assert.match(src, /free-sleep-rollback\.service/);
    assert.match(src, /NOPASSWD: \/bin\/systemctl start free-sleep-rollback\.service --no-block/);
  });
});
