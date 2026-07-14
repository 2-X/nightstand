import { describe, expect, it } from 'vitest';
import { appendCapped, MAX_LOG_LINES } from './logsBuffer.ts';

describe('appendCapped', () => {
  it('appends under the cap without dropping anything', () => {
    expect(appendCapped(['a', 'b'], ['c'], 5)).toEqual(['a', 'b', 'c']);
  });

  it('drops the oldest lines once the cap is exceeded', () => {
    const prev = ['a', 'b', 'c'];
    const next = ['d', 'e'];
    expect(appendCapped(prev, next, 4)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('keeps only the newest lines when a single append exceeds the cap', () => {
    const next = ['a', 'b', 'c', 'd', 'e'];
    expect(appendCapped([], next, 3)).toEqual(['c', 'd', 'e']);
  });

  it('never returns more than the cap regardless of how large prev already is', () => {
    const prev = Array.from({ length: 10_000 }, (_, i) => `line-${i}`);
    const result = appendCapped(prev, ['new'], 1000);
    expect(result).toHaveLength(1000);
    expect(result[result.length - 1]).toBe('new');
  });

  it('defaults the cap to MAX_LOG_LINES', () => {
    const prev = Array.from({ length: 1000 }, (_, i) => `line-${i}`);
    const result = appendCapped(prev, ['a', 'b']);
    expect(result).toHaveLength(MAX_LOG_LINES);
    expect(result[result.length - 1]).toBe('b');
  });
});
