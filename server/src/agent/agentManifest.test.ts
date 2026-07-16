import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_MANIFEST, AGENT_BASE, STOCK_CONTRACT } from './agentManifest.js';

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

// Node builtins are supplied by the runtime, not shipped by stock, so they
// are not a stock dependency and do not belong in STOCK_CONTRACT.packages.
// The bare (unprefixed) forms actually used by agent files and their tests.
const NODE_BUILTINS_BARE = ['fs', 'path', 'url', 'child_process'];
const isNodeBuiltin = (specifier: string) => (
  specifier.startsWith('node:') || NODE_BUILTINS_BARE.includes(specifier)
);

// Only files with an import graph to read. Shell scripts and systemd units
// have none, and JSON imports nothing.
const isSource = (p: string) => /\.(ts|tsx)$/.test(p);

const importsOf = (source: string): string[] => {
  const specifiers: string[] = [];
  const re = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  let match = re.exec(source);
  while (match !== null) {
    specifiers.push(match[1]);
    match = re.exec(source);
  }
  return specifiers;
};

// Returns a repo-relative path for a repo-local import, or null for a bare
// package specifier.
const resolveSpecifier = (fromPath: string, specifier: string): string | null => {
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (specifier.startsWith(alias)) {
      return path.posix.normalize(target + specifier.slice(alias.length));
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

const packageOf = (specifier: string): string => (
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
);

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
      // repo's version would check imports that never reach the overlay.
      // The generator asserts the patch applied and the only import it adds
      // is an agent file, so the boundary is still enforced, just elsewhere.
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
