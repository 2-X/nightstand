import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { AGENT_MANIFEST, AGENT_BASE, STOCK_CONTRACT, NODE_BUILTINS_BARE } from './agentManifest.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const ALIASES: Record<string, string> = {
  '@api/': 'app/src/api/',
  '@components/': 'app/src/components/',
  '@design/': 'app/src/design/',
  '@state/': 'app/src/state/',
  '@lib/': 'app/src/lib/',
};

const agentPaths = new Set(AGENT_MANIFEST.map((entry) => entry.path));
const contractPaths = new Set(STOCK_CONTRACT.paths);

const packageOf = (specifier: string): string => (
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
);

// node:-prefixed builtins are always allowed; this is the resolution rule,
// the actual bare-form allowlist lives in agentManifest.ts as
// NODE_BUILTINS_BARE. A bare subpath specifier (e.g. 'fs/promises') is
// checked by its base module, same as a bare package specifier.
const isNodeBuiltin = (specifier: string) => (
  specifier.startsWith('node:') || NODE_BUILTINS_BARE.includes(packageOf(specifier))
);

// Only files with an import graph to read. Shell scripts and systemd units
// have none, and JSON imports nothing.
const isSource = (p: string) => /\.(ts|tsx)$/.test(p);

// TypeScript's own pre-processor extracts every import form (static, export
// ... from, dynamic import(), any whitespace or line layout) instead of a
// hand-rolled regex trying to keep up with all of them.
const importsOf = (source: string): string[] => (
  ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName)
);

// Returns a repo-relative path for a repo-local import, or null for a bare
// package specifier.
const resolveSpecifier = (fromPath: string, specifier: string): string | null => {
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (specifier.startsWith(alias)) {
      const resolved = path.posix.normalize(target + specifier.slice(alias.length));
      // Alias imports are extensionless too, e.g. '@api/jobs'. Try the same
      // TypeScript extensions the relative-path fallback below tries.
      if (!path.posix.extname(resolved) && !existsSync(path.join(repoRoot, resolved))) {
        for (const ext of ['.ts', '.tsx']) {
          if (existsSync(path.join(repoRoot, resolved + ext))) return resolved + ext;
        }
      }
      return resolved;
    }
  }
  if (!specifier.startsWith('.')) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  // Server source is ESM: it imports './x.js' but the file on disk is './x.ts'.
  if (resolved.endsWith('.js') && !existsSync(path.join(repoRoot, resolved))) {
    return resolved.replace(/\.js$/, '.ts');
  }
  // App source imports extensionless, e.g. './api'. Try the TypeScript
  // extensions the resolver would actually find on disk.
  if (!path.posix.extname(resolved) && !existsSync(path.join(repoRoot, resolved))) {
    for (const ext of ['.ts', '.tsx']) {
      if (existsSync(path.join(repoRoot, resolved + ext))) return resolved + ext;
    }
  }
  return resolved;
};

describe('the agent manifest', () => {
  it('names only paths that exist in this repo', () => {
    for (const entry of AGENT_MANIFEST) {
      assert.ok(existsSync(path.join(repoRoot, entry.path)), `${entry.path} is in the manifest but not in the tree`);
    }
  });

  it('pins the base by a full commit sha, since upstream publishes no tags', () => {
    assert.match(AGENT_BASE.sha, /^[0-9a-f]{40}$/);
    assert.match(AGENT_BASE.version, /^\d+\.\d+\.\d+$/);
  });

  it('gives every entry a reason', () => {
    for (const entry of AGENT_MANIFEST) {
      assert.ok(entry.why.length > 0, `${entry.path} has no why`);
    }
  });

  it('lists each path once', () => {
    const paths = AGENT_MANIFEST.map((entry) => entry.path);
    assert.deepEqual(paths, [...new Set(paths)]);
  });

  it('patches only the two files a copy would break', () => {
    const patched = AGENT_MANIFEST.filter((entry) => entry.mode === 'patch').map((entry) => entry.path).sort();
    assert.deepEqual(patched, ['server/package.json', 'server/src/setup/routes.ts']);
  });

  // routes.ts is skipped by the closure walk below because its content in
  // this repo is not what ships (see that walk's comment). This is the one
  // check available on it now: the patch this repo carries adds the update
  // route import, and that import resolves to an agent path.
  it('patches routes.ts to import the update route, and that route is an agent path', () => {
    const source = readFileSync(path.join(repoRoot, 'server/src/setup/routes.ts'), 'utf8');
    assert.match(source, /^\s*import update from '\.\.\/routes\/update\/update\.js';\s*$/m);
    assert.ok(agentPaths.has('server/src/routes/update/update.ts'));
  });

  it('never lists a stock-contract path as an agent file', () => {
    for (const contractPath of STOCK_CONTRACT.paths) {
      assert.ok(
        !agentPaths.has(contractPath),
        `${contractPath} is both an agent file and a stock dependency; it must be one or the other`,
      );
    }
  });
});

// The gate. The agent's whole claim is that it is small enough to drop onto a
// stock install without dragging this tree along. That claim holds only while
// every agent file imports nothing but other agent files and the short list of
// stock modules declared in STOCK_CONTRACT. A boundary defended by prose rots
// silently and gets found later by a user, so it is defended here instead.
describe('the agent import closure', () => {
  it('never reaches outside the manifest and the declared stock contract', () => {
    const escapes: string[] = [];

    for (const entry of AGENT_MANIFEST) {
      if (!isSource(entry.path)) continue;
      // A patch-mode file's content in this repo is not what ships in the
      // overlay: the generator applies a small patch to stock's own copy
      // instead of copying this tree's version wholesale. Walking this
      // repo's version would check imports that never reach the overlay, so
      // this file's imports are NOT covered by this walk. The one thing
      // pinned instead is the invariant just below: the patch this repo
      // carries for server/src/setup/routes.ts imports the update route,
      // and that import resolves to an agent path.
      if (entry.mode === 'patch') continue;
      const source = readFileSync(path.join(repoRoot, entry.path), 'utf8');

      for (const specifier of importsOf(source)) {
        const resolved = resolveSpecifier(entry.path, specifier);

        if (resolved === null) {
          if (!isNodeBuiltin(specifier) && !STOCK_CONTRACT.packages.includes(packageOf(specifier))) {
            escapes.push(`${entry.path} imports package "${specifier}", which is not in the stock contract`);
          }
          continue;
        }
        if (agentPaths.has(resolved) || contractPaths.has(resolved)) continue;
        escapes.push(`${entry.path} imports "${specifier}" (${resolved}), which is neither an agent file nor in the stock contract`);
      }
    }

    assert.deepEqual(escapes, [], `the agent reaches outside its boundary:\n${escapes.join('\n')}`);
  });
});
