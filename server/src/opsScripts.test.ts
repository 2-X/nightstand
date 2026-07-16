import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This repo's own dev and deploy tooling, which deliberately does not ship
// in the agent overlay (see agentManifest.ts): ops/deploy.sh and
// ops/rollback.sh never reach a pod, and scripts/enable_biometrics.sh /
// scripts/disable_biometrics.sh are stock's own files, which the agent must
// not touch. Because none of that is agent-owned, coverage for it lives here
// rather than in updaterScripts.test.ts, which ships inside the overlay and
// may only assert about files the overlay carries.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const OPS_SCRIPTS = ['ops/deploy.sh', 'ops/rollback.sh'];
const STOCK_BIOMETRICS_SCRIPTS = ['scripts/enable_biometrics.sh', 'scripts/disable_biometrics.sh'];

describe('this repo\'s own tooling (not part of the agent overlay)', () => {
  for (const script of [...OPS_SCRIPTS, ...STOCK_BIOMETRICS_SCRIPTS]) {
    it(`${script} exists and parses (bash -n)`, () => {
      const full = path.join(repoRoot, script);
      assert.equal(existsSync(full), true, `${script} is missing`);
      assert.doesNotThrow(() => execFileSync('bash', ['-n', full]));
    });
  }

  for (const script of [...OPS_SCRIPTS, ...STOCK_BIOMETRICS_SCRIPTS]) {
    it(`${script} is executable in this repo`, () => {
      const mode = statSync(path.join(repoRoot, script)).mode;
      assert.ok(mode & 0o111, `${script} must carry the exec bit`);
    });
  }

  it('disable_biometrics.sh actually stops and disables the stream service', () => {
    const src = readFileSync(path.join(repoRoot, 'scripts/disable_biometrics.sh'), 'utf8');
    assert.match(src, /systemctl stop free-sleep-stream/);
    assert.match(src, /systemctl disable free-sleep-stream/);
  });
});
