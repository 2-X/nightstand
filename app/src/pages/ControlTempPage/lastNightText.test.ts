import { expect, it } from 'vitest';
import { lastNightText } from './lastNightText';

it('says time in bed plainly', () => {
  expect(lastNightText({ score: 72, duration: '8h in bed' })).toBe('Last night: 8h in bed');
});

it('shows nothing for a score without a duration', () => {
  expect(lastNightText({ score: 86 })).toBeUndefined();
  expect(lastNightText({ score: 86, duration: '' })).toBeUndefined();
});

it('shows nothing for a duration it does not recognise', () => {
  expect(lastNightText({ score: 86, duration: '6h 30m' })).toBeUndefined();
});
