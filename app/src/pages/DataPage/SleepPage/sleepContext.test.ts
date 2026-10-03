import { describe, expect, it } from 'vitest';
import { formatSleepDuration, nightDuration, nightMarkHeight, summarizeDurations } from './sleepContext';

describe('night duration presentation', () => {
  it('always reports time in bed and ignores any stage data', () => {
    const withStages = nightDuration as (seconds: number, stages?: unknown) => ReturnType<typeof nightDuration>;
    const stages = { active: true, epochs: [{ stage: 'light' }], totals: { light: 18000, rem: 3600, deep: 1800, awake: 3600 } };
    expect(nightDuration(27000)).toEqual({ seconds: 27000, kind: 'in bed' });
    expect(withStages(27000, stages)).toEqual({ seconds: 27000, kind: 'in bed' });
  });
  it('averages time in bed across nights', () => {
    expect(summarizeDurations([nightDuration(27000), nightDuration(28800)])).toEqual({ average: 27900, nights: 2 });
    expect(summarizeDurations([])).toBeUndefined();
  });
  it.each([[0, '0h'], [25200, '7h'], [23400, '6h 30m']])('formats %s without zero minutes', (seconds, expected) => {
    expect(formatSleepDuration(seconds)).toBe(expected);
  });
});

it('sizes week marks in proportion to sleep so short nights stay distinguishable', () => {
  expect(nightMarkHeight(0)).toBe(4);
  expect(nightMarkHeight(5.5 * 3600)).toBeGreaterThan(nightMarkHeight(3 * 3600));
  expect(nightMarkHeight(3 * 3600)).toBeGreaterThan(nightMarkHeight(0));
  expect(nightMarkHeight(9 * 3600)).toBe(40);
  expect(nightMarkHeight(12 * 3600)).toBe(40);
});
