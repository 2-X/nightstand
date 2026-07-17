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

// The pod's inbound TCP path stalls now and then under a sustained upload.
// When it does, the pod's sshd sees no keepalive reply (the client's replies
// are queued behind the stalled bulk data, same direction) and hangs up after
// ClientAliveInterval 15 x ClientAliveCountMax 4, about 75 seconds in. That is
// a property of the link, not of the tree being shipped, and a fresh attempt
// almost always works. Shipping the whole tree as one unresumable stream with
// no retry therefore turned an occasional stall into a failed deploy.
describe('deploy.sh survives a stalled upload', () => {
  const src = readFileSync(path.join(repoRoot, 'ops/deploy.sh'), 'utf8');

  it('retries the staging ship rather than failing the deploy on one stall', () => {
    assert.match(src, /SHIP_ATTEMPTS=/, 'deploy.sh must define a ship retry count');
    assert.match(
      src,
      /while \[ "?\$?attempt"? -le "?\$SHIP_ATTEMPTS"? \]|for attempt in \$\(seq 1 "?\$SHIP_ATTEMPTS"?\)/,
      'the staging ship must run inside a retry loop',
    );
  });

  it('gives the ship its own stall detection so a hung attempt fails fast', () => {
    assert.match(src, /ServerAliveInterval/, 'the ship must detect a stall itself');
    assert.match(src, /ServerAliveCountMax/, 'the ship must bound how long it waits on a stall');
  });

  it('verifies the staged tree arrived whole before anything is swapped', () => {
    assert.match(
      src,
      /STAGE\/server\/dist\/server\.js/,
      'a retried, truncatable transfer must be checked for completeness, not assumed',
    );
  });

  it('still aborts the deploy if every attempt stalls', () => {
    assert.match(src, /die "staging ship failed/, 'exhausting the retries must abort, never swap a partial tree');
  });
});
