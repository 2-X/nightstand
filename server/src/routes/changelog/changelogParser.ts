import type { ChangelogEntry } from './changelogSchema.js';

// Matches "## [3.1.0] - 2026-07-10" style headings. Anything else at the
// same heading level (an "## [Unreleased]" section, a stray "## Notes", a
// future format we haven't thought of) is treated as non-entry content and
// its lines are dropped rather than crashing the parser: this runs against
// a hand-edited markdown file, and a malformed heading should degrade to
// "one fewer entry", never a 500 on /api/changelog.
const HEADING_RE = /^##\s*\[(\d+\.\d+\.\d+)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/;

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (current) {
      entries.push({ ...current, body: bodyLines.join('\n').trim() });
    }
    current = null;
    bodyLines = [];
  };

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match) {
      flush();
      current = { version: match[1], date: match[2], body: '' };
      continue;
    }
    if (line.startsWith('## ') || line.startsWith('##\t')) {
      // A different kind of "##" heading (Unreleased, preamble notes, etc.):
      // end whatever entry was open; its lines don't belong to any version.
      flush();
      continue;
    }
    if (current) {
      bodyLines.push(line);
    }
  }
  flush();

  return entries;
}
