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
// A deploy host and a pod that are both Wi-Fi stations on one subnet do not
// talk to each other directly: the access point receives every frame on its
// radio and retransmits it on that same radio, so a sustained upload between
// them costs double the airtime of an ordinary download and collapses at a
// far lower rate. Past that rate the path wedges instead of degrading, and
// the transfer dies once the pod's sshd stops seeing keepalive replies,
// around ClientAliveInterval 15 x ClientAliveCountMax 4. Measured on one such
// link: 36 MB lands in 8.7s throttled to 4 MB/s, while 6 MB/s and anything
// above it hang outright. Plain scp and an unrelated HTTP pull stall exactly
// the same way, so the cliff belongs to the path, not to ssh or tar. The ship
// therefore paces itself under the cliff rather than letting TCP find it, and
// still retries, because one stall must not end a deploy.
describe('deploy.sh survives a stalled upload', () => {
    const src = readFileSync(path.join(repoRoot, 'ops/deploy.sh'), 'utf8');
    it('retries the staging ship rather than failing the deploy on one stall', () => {
        assert.match(src, /SHIP_ATTEMPTS=/, 'deploy.sh must define a ship retry count');
        assert.match(src, /while \[ "?\$?attempt"? -le "?\$SHIP_ATTEMPTS"? \]|for attempt in \$\(seq 1 "?\$SHIP_ATTEMPTS"?\)/, 'the staging ship must run inside a retry loop');
    });
    it('gives the ship its own stall detection so a hung attempt fails fast', () => {
        assert.match(src, /ServerAliveInterval/, 'the ship must detect a stall itself');
        assert.match(src, /ServerAliveCountMax/, 'the ship must bound how long it waits on a stall');
    });
    it('verifies the staged tree arrived whole before anything is swapped', () => {
        assert.match(src, /STAGE\/server\/dist\/server\.js/, 'a retried, truncatable transfer must be checked for completeness, not assumed');
    });
    it('still aborts the deploy if every attempt stalls', () => {
        assert.match(src, /die "staging ship failed/, 'exhausting the retries must abort, never swap a partial tree');
    });
    it('paces the ship with a rate limit rather than letting TCP find the cliff', () => {
        assert.match(src, /SHIP_RATE_KBIT=/, 'deploy.sh must define a ship rate limit');
        assert.match(src, /-l "\$SHIP_RATE_KBIT"/, 'the limit must be applied to the transfer, not just declared');
    });
    it('defaults that rate below where a relayed wireless upload collapses', () => {
        const match = src.match(/SHIP_RATE_KBIT="\$\{SHIP_RATE_KBIT:-(\d+)\}"/);
        assert.ok(match, 'SHIP_RATE_KBIT must carry an overridable default');
        // 4 MB/s = 32000 Kbit/s was the fastest rate observed to land the whole
        // tree; 6 MB/s hung. Anything above this ships a deploy that cannot finish.
        assert.ok(Number(match[1]) <= 32000, `default ${match[1]} Kbit/s is at or above the rate where the upload wedges`);
    });
});
//# sourceMappingURL=opsScripts.test.js.map