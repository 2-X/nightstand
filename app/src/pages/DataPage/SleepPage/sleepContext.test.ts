import { describe, expect, it } from 'vitest';
import type { SleepStagesResponse } from '@api/sleepStages';
import { contributorBand, formatSleepDuration, nightDuration, nightMarkHeight, summarizeDurations } from './sleepContext';

const stages: SleepStagesResponse = {
  active: true, epochs: [{ stage: 'light', startUnix: 0, endUnix: 23400 }],
  totals: { light: 18000, rem: 3600, deep: 1800, awake: 3600 },
  percentages: { light: 70, rem: 14, deep: 7, awake: 9 }, totalSeconds: 27000,
};
describe('night duration presentation', () => {
  it('uses classified asleep time and otherwise labels presence as time in bed', () => {
    expect(nightDuration(27000, stages)).toEqual({ seconds: 23400, kind: 'asleep' });
    expect(nightDuration(27000)).toEqual({ seconds: 27000, kind: 'in bed' });
    expect(nightDuration(27000, { ...stages, epochs: [] })).toEqual({ seconds: 27000, kind: 'in bed' });
    expect(nightDuration(27000, { ...stages, active: false })).toEqual({ seconds: 27000, kind: 'in bed' });
  });
  it('reports time in bed when vitals coverage was too low to find sleep onset', () => {
    expect(nightDuration(27000, { ...stages, lowCoverage: true })).toEqual({ seconds: 27000, kind: 'in bed' });
    expect(nightDuration(27000, { ...stages, lowCoverage: false })).toEqual({ seconds: 23400, kind: 'asleep' });
  });
  it('keeps mixed stage coverage in separate averages', () => {
    expect(summarizeDurations([nightDuration(27000, stages), nightDuration(28800)])).toEqual([
      { kind: 'asleep', average: 23400, nights: 1 }, { kind: 'in bed', average: 28800, nights: 1 },
    ]);
    expect(summarizeDurations([nightDuration(27000, stages), nightDuration(27000, stages)])[0].average).toBe(23400);
  });
  it.each([[0, '0h'], [25200, '7h'], [23400, '6h 30m']])('formats %s without zero minutes', (seconds, expected) => {
    expect(formatSleepDuration(seconds)).toBe(expected);
  });
  it.each([[85, 'Good'], [100, 'Good'], [84, 'Fair'], [70, 'Fair'], [69, 'Low'], [0, 'Low']])(
    'labels contributor score %s', (score, expected) => {
      expect(contributorBand(score)).toBe(expected);
    });
});

it('sizes week marks in proportion to sleep so short nights stay distinguishable', () => {
  expect(nightMarkHeight(0)).toBe(4);
  expect(nightMarkHeight(5.5 * 3600)).toBeGreaterThan(nightMarkHeight(3 * 3600));
  expect(nightMarkHeight(3 * 3600)).toBeGreaterThan(nightMarkHeight(0));
  expect(nightMarkHeight(9 * 3600)).toBe(40);
  expect(nightMarkHeight(12 * 3600)).toBe(40);
});
