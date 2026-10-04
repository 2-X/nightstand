import { describe, expect, it } from 'vitest';
import { SWEEP } from '../e2e/routes';
import { pageRoutes } from './test/pageRoutes';

describe('layout sweep route table', () => {
  it('visits every routed page', () => {
    const swept = new Set(SWEEP.map(entry => entry.path.split('?')[0]));
    const missing = ['/', ...pageRoutes().map(route => `/${route}`)].filter(route => !swept.has(route));
    expect(missing).toEqual([]);
  });

  it('names every state once', () => {
    const names = SWEEP.map(entry => entry.name);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });
});
