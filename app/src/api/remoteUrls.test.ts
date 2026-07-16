import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The three files the app fetches from GitHub all have to name this fork. The
// pod has no WAN, so these only ever resolve from the browser, and nothing at
// runtime notices if one points somewhere else.
//
// Regression coverage: serverInfo.ts asked the upstream project for the newest
// version and compared it against this fork's own stream. Upstream's 2.x is
// never newer than 3.x, so updateAvailable was permanently false, the pod
// reported itself up to date no matter how far behind it was, and the Update
// button, which only renders inside that alert, never appeared at all.
const apiDir = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.join(apiDir, file), 'utf8');

const THIS_FORK = 'https://raw.githubusercontent.com/LTimothy/nightstand/main';

describe('the app\'s remote GitHub fetches', () => {
  it('asks this fork for the newest published build', () => {
    expect(read('serverInfo.ts')).toContain(`${THIS_FORK}/server/src/serverInfo.json`);
  });

  it('asks this fork for the release manifest', () => {
    expect(read('releases.ts')).toContain(`${THIS_FORK}/releases.json`);
  });

  it('asks this fork for the changelog', () => {
    expect(read('changelog.ts')).toContain(`${THIS_FORK}/CHANGELOG.md`);
  });

  it('asks the upstream project for none of them', () => {
    for (const file of ['serverInfo.ts', 'releases.ts', 'changelog.ts']) {
      expect(read(file), `${file} still fetches from upstream`).not.toContain('throwaway31265');
    }
  });
});
