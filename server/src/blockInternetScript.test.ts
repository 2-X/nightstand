import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// block_internet_access.sh runs as root on the pod and saves its result, so
// it is checked by its structure here rather than run.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'scripts/block_internet_access.sh');
const src = readFileSync(SCRIPT, 'utf8');

describe('block_internet_access.sh', () => {
  it('parses', () => {
    assert.doesNotThrow(() => execFileSync('bash', ['-n', SCRIPT]));
  });

  it('resets the firmware cloud connection before the final drop', () => {
    const reset = src.indexOf('iptables -A OUTPUT -p tcp --dport 1337 -j REJECT --reject-with tcp-reset');
    const drop = src.indexOf('iptables -A OUTPUT -j DROP');
    const save = src.indexOf('iptables-save');
    assert.ok(reset !== -1, 'no tcp-reset rule for port 1337');
    assert.ok(reset < drop && drop < save, 'reset rule must come before the final drop and the save');
  });

  it('still saves both rulesets', () => {
    assert.match(src, /iptables-save > \/etc\/iptables\/iptables\.rules/);
    assert.match(src, /ip6tables-save > \/etc\/iptables\/ip6tables\.rules/);
  });
});
