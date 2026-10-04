import { expect, it } from 'vitest';
import { lastNightText } from './lastNightText';

it('says time in bed plainly', () => {
  expect(lastNightText({ duration: '8h in bed' })).toBe('Last night: 8h in bed');
});
