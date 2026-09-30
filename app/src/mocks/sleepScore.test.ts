import { expect, it } from 'vitest';
import { getSleepScore, getSleepStages } from './mockData';

it('describes the demo duration contribution by time asleep, like the server', () => {
  const startTime = '2026-09-28T06:00:00Z';
  const endTime = '2026-09-28T13:12:00Z';
  const { totals } = getSleepStages(startTime, endTime);
  const asleepMinutes = Math.round((totals.light + totals.rem + totals.deep) / 60);
  const value = getSleepScore(startTime, endTime).components.duration?.value;
  expect(value).toBe(`${Math.floor(asleepMinutes / 60)}h ${asleepMinutes % 60}m asleep`);
  expect(asleepMinutes).toBeLessThan(7 * 60 + 12);
});
