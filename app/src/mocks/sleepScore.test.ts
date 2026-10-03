import { expect, it } from 'vitest';
import { getSleepScore } from './mockData';

it('describes the demo duration contribution by time in bed, like the server', () => {
  const duration = getSleepScore('2026-09-28T06:00:00Z', '2026-09-28T13:12:00Z').components.duration;
  expect(duration?.value).toBe('7h 12m in bed');
  expect(duration?.score).toBe(92);
});

it('drops the minutes from a whole number of hours, like the server', () => {
  expect(getSleepScore('2026-09-28T06:00:00Z', '2026-09-28T14:00:00Z').components.duration?.value).toBe('8h in bed');
});

it('gives the demo score no HRV contribution, like the server', () => {
  const { components } = getSleepScore('2026-09-28T06:00:00Z', '2026-09-28T13:12:00Z');
  const hrv = (components as Record<string, { available: boolean; value: string } | undefined>).hrv;
  expect(hrv === undefined || (!hrv.available && hrv.value === '')).toBe(true);
});
