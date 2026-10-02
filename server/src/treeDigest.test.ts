import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT_MANIFEST } from './agent/agentManifest.js';

// scripts/tree_digest.py is what a release's published checksum is computed
// with, on the Mac at release time and on the Pod before an install. Both
// must arrive at the same value for the same tree, whatever the archive did
// to timestamps and permissions.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = (dir: string) => execFileSync('python3', [path.join(repoRoot, 'scripts/tree_digest.py'), dir], { encoding: 'utf8' }).trim();

function tree(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-tree-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

describe('tree_digest.py', () => {
  it('ignores releases.json, timestamps and permissions', () => {
    const a = tree({ 'a.txt': 'one', 'server/b.js': 'two', 'releases.json': '{"x":1}' });
    const b = tree({ 'server/b.js': 'two', 'a.txt': 'one', 'releases.json': '{"x":2}' });
    chmodSync(path.join(b, 'a.txt'), 0o755);
    assert.equal(digest(a), digest(b));
    rmSync(a, { recursive: true });
    rmSync(b, { recursive: true });
  });

  it('leaves out only the top-level releases.json', () => {
    const a = tree({ 'a.txt': 'one', 'docs/releases.json': '1' });
    const b = tree({ 'a.txt': 'one', 'docs/releases.json': '2' });
    assert.notEqual(digest(a), digest(b));
    rmSync(a, { recursive: true });
    rmSync(b, { recursive: true });
  });

  it('changes when any file or name changes, and counts symlinks', () => {
    const base = tree({ 'a.txt': 'one' });
    const changed = tree({ 'a.txt': 'onf' });
    const renamed = tree({ 'b.txt': 'one' });
    const linked = tree({ 'a.txt': 'one' });
    symlinkSync('a.txt', path.join(linked, 'l'));
    const dirLinked = tree({ 'sub/a.txt': 'one' });
    const dirPlain = tree({ 'sub/a.txt': 'one' });
    symlinkSync('sub', path.join(dirLinked, 'alias'));
    assert.notEqual(digest(base), digest(changed));
    assert.notEqual(digest(base), digest(renamed));
    assert.notEqual(digest(base), digest(linked));
    assert.notEqual(digest(dirLinked), digest(dirPlain));
    for (const dir of [base, changed, renamed, linked, dirLinked, dirPlain]) rmSync(dir, { recursive: true });
  });

  it('digests what git archive of HEAD produces, read directly or unpacked', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'nightstand-archive-'));
    execFileSync('bash', ['-c', `git -C "${repoRoot}" archive HEAD | tar -x -C "${out}"`]);
    const fromTar = execFileSync('bash', ['-c',
      `git -C "${repoRoot}" archive HEAD | python3 "${repoRoot}/scripts/tree_digest.py" --tar -`], { encoding: 'utf8' }).trim();
    assert.match(fromTar, /^[0-9a-f]{64}$/);
    assert.equal(digest(out), fromTar);
    rmSync(out, { recursive: true });
  });

  it('ships in the overlay, so a stock install can check its first update', () => {
    const entry = AGENT_MANIFEST.find(item => item.path === 'scripts/tree_digest.py');
    assert.ok(entry, 'scripts/tree_digest.py is not in the agent manifest');
    assert.equal(entry.mode, 'add');
  });
});
