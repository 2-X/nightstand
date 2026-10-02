import { describe, expect, it } from 'vitest';
import { summary } from './releaseSummary';

describe('summary', () => {
  it('takes the first sentence of the first block', () => {
    expect(summary('Sleep data loads again. More.\n\n- Detail.')).toBe('Sleep data loads again.');
  });

  it('joins a list of short bullets with semicolons', () => {
    expect(summary('- Fix X\n- Fix Y')).toBe('Fix X; Fix Y');
  });

  it('joins wrapped lines of one bullet with a space', () => {
    expect(summary('- Reinstalling keeps\n  sleep data')).toBe('Reinstalling keeps sleep data');
  });

  it('drops image markup and keeps link text', () => {
    expect(summary('![chart](x.png) See [the guide](https://example.com) now')).toBe('See the guide now');
  });

  it('marks a cut at 180 characters with an ellipsis', () => {
    const out = summary('word '.repeat(60).trim());
    expect(out?.length).toBe(180);
    expect(out?.endsWith('…')).toBe(true);
  });

  it('skips a heading to the notes under it', () => {
    expect(summary('### Fixed\n- One\n- Two')).toBe('One; Two');
  });

  it('has no summary for an empty or heading-only body', () => {
    expect(summary('')).toBeUndefined();
    expect(summary('  \n\n')).toBeUndefined();
    expect(summary('## Notes')).toBeUndefined();
  });
});
