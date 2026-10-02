import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/release_digest.sh writes each release's tree digest into
// releases.json during the release ritual. A wrong digest makes every Pod
// refuse that release, so it is checked here on a throwaway repository.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(repoRoot, 'scripts/release_digest.sh');

const MANIFEST = {
  channels: ['stable', 'beta'],
  releases: [
    { kind: 'bundle', version: '1.1.0', channel: 'beta', date: '2026-10-02', upstreamBase: '2.1.5', features: ['a'] },
    { kind: 'bundle', version: '1.0.0', channel: 'stable', date: '2026-10-01', upstreamBase: '2.1.5', features: ['a'] },
  ],
};
const manifestText = JSON.stringify(MANIFEST, null, 2) + '\n';
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
};

// A repository where 1.0.0 is tagged and HEAD is the 1.1.0 release commit.
function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-digest-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env }).trim();
  git('init', '-q');
  mkdirSync(path.join(dir, 'scripts'));
  mkdirSync(path.join(dir, 'server/src'), { recursive: true });
  copyFileSync(script, path.join(dir, 'scripts/release_digest.sh'));
  copyFileSync(path.join(repoRoot, 'scripts/tree_digest.py'), path.join(dir, 'scripts/tree_digest.py'));
  writeFileSync(path.join(dir, 'releases.json'), manifestText);
  writeFileSync(path.join(dir, 'server/src/serverInfo.json'), '{"version":"1.0.0"}\n');
  writeFileSync(path.join(dir, 'a.txt'), 'first');
  git('add', '-A');
  git('commit', '-q', '-m', 'release 1.0.0');
  git('tag', 'v1.0.0');
  writeFileSync(path.join(dir, 'a.txt'), 'second');
  writeFileSync(path.join(dir, 'server/src/serverInfo.json'), '{"version":"1.1.0"}\n');
  git('commit', '-q', '-am', 'release 1.1.0');
  const run = (...args: string[]) => spawnSync('bash', [path.join(dir, 'scripts/release_digest.sh'), ...args], { encoding: 'utf8', env });
  const digestOf = (ref: string) => execFileSync('bash', ['-c',
    `git -C "${dir}" archive "${ref}" | python3 "${dir}/scripts/tree_digest.py" --tar -`], { encoding: 'utf8', env }).trim();
  const manifest = () => JSON.parse(readFileSync(path.join(dir, 'releases.json'), 'utf8')) as {
    releases: { version: string; treeSha256?: string }[];
  };
  return { dir, git, run, digestOf, manifest };
}

describe('release_digest.sh', () => {
  it('exists, is executable, and parses (bash -n)', () => {
    assert.equal(existsSync(script), true);
    assert.ok(statSync(script).mode & 0o111, 'must carry the exec bit');
    assert.doesNotThrow(() => execFileSync('bash', ['-n', script]));
  });

  it('writes the digest of HEAD into the newest entry and amends the release commit', () => {
    const { dir, git, run, digestOf, manifest } = repo();
    const before = git('rev-parse', 'HEAD');
    const result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /treeSha256 written for v1\.1\.0/);
    assert.match(manifest().releases[0].treeSha256 ?? '', /^[0-9a-f]{64}$/);
    assert.equal(manifest().releases[0].treeSha256, digestOf('HEAD'));
    assert.equal(manifest().releases[1].treeSha256, undefined);
    assert.notEqual(git('rev-parse', 'HEAD'), before, 'the release commit is amended');
    assert.equal(git('log', '--format=%s', '-1'), 'release 1.1.0');
    assert.equal(git('rev-list', '--count', 'HEAD'), '2');
    assert.equal(git('status', '--porcelain'), '');
    rmSync(dir, { recursive: true, force: true });
  });

  it('changes nothing in releases.json but the added digest lines', () => {
    const { dir, run } = repo();
    assert.equal(run().status, 0);
    const written = readFileSync(path.join(dir, 'releases.json'), 'utf8');
    const without = written.split('\n').filter((line) => !line.includes('"treeSha256"'));
    const original = manifestText.split('\n');
    // The line before the added key gains a comma.
    assert.deepEqual(without.map((line) => line.replace(/,$/, '')), original.map((line) => line.replace(/,$/, '')));
    assert.equal(written.split('\n').length, original.length + 1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses when anything is uncommitted, and when HEAD is not the newest release', () => {
    const dirty = repo();
    writeFileSync(path.join(dirty.dir, 'b.txt'), 'new');
    const refused = dirty.run();
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /commit everything first/);
    assert.equal(dirty.manifest().releases[0].treeSha256, undefined);
    rmSync(dirty.dir, { recursive: true, force: true });

    const behind = repo();
    writeFileSync(path.join(behind.dir, 'server/src/serverInfo.json'), '{"version":"1.0.0"}\n');
    behind.git('commit', '-q', '-am', 'not a release');
    const mismatched = behind.run();
    assert.notEqual(mismatched.status, 0);
    assert.match(mismatched.stderr, /serverInfo\.json says 1\.0\.0 but the newest release is 1\.1\.0/);
    assert.equal(behind.manifest().releases[0].treeSha256, undefined);
    rmSync(behind.dir, { recursive: true, force: true });
  });

  it('refuses a tree with .gitattributes, which could make git archive differ from GitHub\'s archive', () => {
    const { dir, git, run, manifest } = repo();
    mkdirSync(path.join(dir, 'docs'));
    writeFileSync(path.join(dir, 'docs/.gitattributes'), '*.txt export-subst\n');
    git('add', '-A');
    git('commit', '-q', '--amend', '--no-edit');
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docs\/\.gitattributes/);
    assert.equal(manifest().releases[0].treeSha256, undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it('backfills every tagged release from its tag and leaves the result uncommitted', () => {
    const { dir, git, run, digestOf, manifest } = repo();
    const head = git('rev-parse', 'HEAD');
    const result = run('--backfill');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /skip v1\.1\.0 \(no tag\)/);
    assert.match(result.stdout, /v1\.0\.0 done/);
    assert.equal(manifest().releases[0].treeSha256, undefined);
    assert.equal(manifest().releases[1].treeSha256, digestOf('v1.0.0'));
    assert.notEqual(digestOf('v1.0.0'), digestOf('HEAD'));
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal(git('status', '--porcelain'), 'M releases.json');
    rmSync(dir, { recursive: true, force: true });
  });
});
