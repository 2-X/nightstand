import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageRoutes } from './test/pageRoutes';

// The demo deploy copies index.html into a folder per route so deep links answer 200.
// A page added to the app without a folder there would answer the 404 fallback instead.
const workflow = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/deploy-demo.yml');

function deployedRoutes() {
  const loop = readFileSync(workflow, 'utf8').match(/for route in ([^;]+); do/);
  expect(loop, 'the route loop in deploy-demo.yml').not.toBeNull();
  return loop![1].trim().split(/\s+/);
}

describe('demo deep links', () => {
  it('gives every page route of the app a folder in the demo deploy, and no others', () => {
    expect([...new Set(deployedRoutes())].sort()).toEqual([...new Set(pageRoutes())].sort());
  });
});
