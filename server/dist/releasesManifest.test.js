import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPDATE_CHANNELS } from './db/settingsSchema.js';
// releases.json is what every install path resolves against: the Versions
// page, update.sh, the migrate tooling, and promote_release.sh. All of them
// look a release up by version alone and trust the list to be newest first.
// Those two properties are what let the manifest carry a kind tag without
// teaching each consumer the difference between an agent and a bundle, so
// they are pinned here rather than defended in five places.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'releases.json'), 'utf8'));
const serverInfo = JSON.parse(readFileSync(path.join(repoRoot, 'server/src/serverInfo.json'), 'utf8'));
const SEMVER = /^\d+\.\d+\.\d+$/;
const KNOWN_CHANNELS = UPDATE_CHANNELS;
const parts = (version) => version.split('.').map(Number);
const compareDesc = (a, b) => {
    const [left, right] = [parts(b), parts(a)];
    for (let i = 0; i < 3; i += 1) {
        if (left[i] !== right[i])
            return left[i] - right[i];
    }
    return 0;
};
const releases = manifest.releases;
describe('releases.json', () => {
    it('keeps the keys every existing consumer already reads', () => {
        for (const release of releases) {
            assert.match(release.version, SEMVER, `${release.version} is not a semver`);
            assert.ok(KNOWN_CHANNELS.includes(release.channel), `${release.version} has unknown channel "${release.channel}"`);
            assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/, `${release.version} has a malformed date`);
        }
    });
    it('tags every release with a known kind', () => {
        for (const release of releases) {
            assert.ok(['agent', 'bundle'].includes(release.kind), `${release.version} has kind "${release.kind}"`);
        }
    });
    it('gives agent releases no base and no features, since the agent overlays whatever stock a pod runs', () => {
        for (const release of releases.filter((entry) => entry.kind === 'agent')) {
            assert.equal(release.upstreamBase, undefined, `agent ${release.version} declares an upstreamBase`);
            assert.equal(release.features, undefined, `agent ${release.version} declares features`);
        }
    });
    it('gives every bundle release a base and a feature list', () => {
        for (const release of releases.filter((entry) => entry.kind === 'bundle')) {
            assert.match(release.upstreamBase ?? '', SEMVER, `bundle ${release.version} has no valid upstreamBase`);
            assert.ok(Array.isArray(release.features), `bundle ${release.version} has no features array`);
        }
    });
    it('has versions unique across kinds, so a version alone resolves exactly one release', () => {
        const versions = releases.map((release) => release.version);
        assert.deepEqual(versions, [...new Set(versions)]);
    });
    it('is ordered newest first, which every consumer assumes', () => {
        const versions = releases.map((release) => release.version);
        assert.deepEqual(versions, [...versions].sort(compareDesc));
    });
    it('declares the channels its releases actually use', () => {
        for (const release of releases) {
            assert.ok(manifest.channels.includes(release.channel), `channel "${release.channel}" is not declared`);
        }
    });
    it('publishes tree checksums as 64 hex characters', () => {
        for (const release of releases.filter((entry) => entry.treeSha256 !== undefined)) {
            assert.match(release.treeSha256 ?? '', /^[0-9a-f]{64}$/, `${release.version} has a malformed treeSha256`);
        }
    });
    // Updaters refuse a download whose digest differs, so a wrong value here
    // blocks that release on every Pod. The newest three releases with a local
    // tag are checked against git archive of the tag, which is what GitHub
    // serves. A clone without tags checks nothing.
    it('publishes the checksum of each recent tagged release tree', (t) => {
        const tagged = releases.filter((release) => {
            const found = spawnSync('git', ['-C', repoRoot, 'rev-parse', '-q', '--verify', `refs/tags/v${release.version}`]).status === 0;
            if (!found)
                t.diagnostic(`skipping v${release.version}: no local tag`);
            return found;
        }).slice(0, 3);
        for (const release of tagged) {
            const digest = execFileSync('bash', ['-c', 'git -C "$1" archive "v$2" | python3 "$1/scripts/tree_digest.py" --tar -',
                'digest', repoRoot, release.version], { encoding: 'utf8' }).trim();
            assert.equal(release.treeSha256, digest, `v${release.version} publishes the wrong treeSha256`);
        }
    });
    it('records the checked upstream commit, if any, in the shape the switch reads', () => {
        const pin = manifest.upstreamSwitch;
        if (pin === undefined)
            return;
        assert.match(pin.commit ?? '', /^[0-9a-f]{40}$/, 'upstreamSwitch.commit must be a full commit id');
        assert.match(pin.date ?? '', /^\d{4}-\d{2}-\d{2}$/);
        if (pin.treeSha256 !== undefined)
            assert.match(pin.treeSha256, /^[0-9a-f]{64}$/);
    });
});
describe('serverInfo.json', () => {
    it('records the upstream release this build was made from', () => {
        assert.match(serverInfo.upstreamBase ?? '', SEMVER);
    });
});
//# sourceMappingURL=releasesManifest.test.js.map