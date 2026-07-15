import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// scripts/promote_release.sh is the release-ritual tool that flips one
// release from beta to stable in releases.json (see CONTRIBUTING.md "Release
// cadence and promotion"). A slip here would either silently corrupt the
// manifest every consumer trusts or refuse a valid promotion, gate the
// behaviour on a throwaway manifest so a bad edit fails this test first.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repoRoot, 'scripts/promote_release.sh');
const MANIFEST = {
    channels: ['stable', 'beta'],
    releases: [
        { version: '3.3.0', channel: 'beta', date: '2026-07-10' },
        { version: '3.2.0', channel: 'stable', date: '2026-07-10' },
        { version: '3.1.0', channel: 'stable', date: '2026-07-09' },
    ],
};
// Run the script inside a temp repo whose releases.json is a fresh copy of
// MANIFEST. Returns { code, stdout, manifest }.
const run = (version) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'promote-'));
    mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    cpSync(script, path.join(dir, 'scripts/promote_release.sh'));
    writeFileSync(path.join(dir, 'releases.json'), JSON.stringify(MANIFEST, null, 2) + '\n');
    let code = 0;
    let stdout = '';
    try {
        stdout = execFileSync('bash', [path.join(dir, 'scripts/promote_release.sh'), version], {
            encoding: 'utf8',
        });
    }
    catch (err) {
        const e = err;
        code = e.status ?? 1;
        stdout = e.stdout ?? '';
    }
    const manifest = JSON.parse(readFileSync(path.join(dir, 'releases.json'), 'utf8'));
    return { code, stdout, manifest };
};
const channelOf = (m, v) => m.releases.find((r) => r.version === v)?.channel;
describe('promote_release.sh', () => {
    it('exists, is executable, and parses (bash -n)', () => {
        assert.equal(existsSync(script), true);
        assert.ok(statSync(script).mode & 0o111, 'must carry the exec bit');
        assert.doesNotThrow(() => execFileSync('bash', ['-n', script]));
    });
    it('promotes a beta to stable and leaves the other entries untouched', () => {
        const { code, manifest } = run('3.3.0');
        assert.equal(code, 0);
        assert.equal(channelOf(manifest, '3.3.0'), 'stable');
        assert.equal(channelOf(manifest, '3.2.0'), 'stable');
        assert.equal(channelOf(manifest, '3.1.0'), 'stable');
        assert.equal(manifest.releases.length, 3, 'must not add or drop entries');
    });
    it('prints the matching gh command with --latest when it becomes the newest stable', () => {
        const { stdout } = run('3.3.0');
        assert.match(stdout, /gh release edit v3\.3\.0 --prerelease=false --latest/);
    });
    it('refuses an unknown version without editing the manifest', () => {
        const { code, manifest } = run('9.9.9');
        assert.equal(code, 1);
        assert.equal(channelOf(manifest, '3.3.0'), 'beta', 'manifest must be unchanged');
    });
    it('is a no-op on an already-stable version', () => {
        const { code, manifest } = run('3.2.0');
        assert.equal(code, 0);
        assert.equal(channelOf(manifest, '3.2.0'), 'stable');
        assert.equal(channelOf(manifest, '3.3.0'), 'beta', 'must not touch other entries');
    });
});
//# sourceMappingURL=promoteRelease.test.js.map