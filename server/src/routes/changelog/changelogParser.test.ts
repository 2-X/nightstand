import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelog } from './changelogParser.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('parseChangelog', () => {
  it('parses a simple entry', () => {
    const md = `# Changelog\n\nSome preamble text.\n\n## [3.1.0] - 2026-07-10\n\n### Fixed\n- did a thing\n`;
    const entries = parseChangelog(md);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].version, '3.1.0');
    assert.equal(entries[0].date, '2026-07-10');
    assert.match(entries[0].body, /did a thing/);
  });

  it('parses multiple entries in order and separates their bodies', () => {
    const md = `## [2.0.0] - 2026-01-01\nfirst\n\n## [1.0.0] - 2025-01-01\nsecond\n`;
    const entries = parseChangelog(md);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].version, '2.0.0');
    assert.match(entries[0].body, /^first/);
    assert.doesNotMatch(entries[0].body, /second/);
    assert.equal(entries[1].version, '1.0.0');
    assert.match(entries[1].body, /second/);
  });

  it('drops preamble text before the first heading', () => {
    const md = `# Changelog\n\nIntro paragraph nobody should see as an entry.\n\n## [1.0.0] - 2025-01-01\nbody\n`;
    const entries = parseChangelog(md);
    assert.equal(entries.length, 1);
    assert.doesNotMatch(entries[0].body, /Intro paragraph/);
  });

  it('tolerates an "Unreleased" section without throwing or emitting a bogus entry', () => {
    const md = `## [Unreleased]\n- wip thing\n\n## [1.0.0] - 2025-01-01\nreal entry\n`;
    const entries = parseChangelog(md);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].version, '1.0.0');
    assert.doesNotMatch(entries[0].body, /wip thing/);
  });

  it('never throws on empty or garbage input', () => {
    assert.deepEqual(parseChangelog(''), []);
    assert.deepEqual(parseChangelog('not a changelog at all, just prose'), []);
    assert.doesNotThrow(() => parseChangelog('## [not-a-version] - whenever\nstuff'));
  });

  it('handles CRLF line endings', () => {
    const md = '## [1.0.0] - 2025-01-01\r\nbody line\r\n';
    const entries = parseChangelog(md);
    assert.equal(entries.length, 1);
    assert.match(entries[0].body, /body line/);
  });

  it('parses the real CHANGELOG.md without throwing', () => {
    // CHANGELOG.md is still being backfilled (only an Unreleased section so
    // far), so this only checks the parser survives the real file, not that
    // it has entries yet.
    const md = readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
    assert.doesNotThrow(() => parseChangelog(md));
  });
});
