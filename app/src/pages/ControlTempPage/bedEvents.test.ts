import { expect, it } from 'vitest';
import moment from 'moment-timezone';
import { nextBedEvent } from './bedEvents';

it('shows the remaining overnight adjustment instead of the next calendar night', () => {
  const schedule = {
    sunday: { power: { on: '21:00', off: '09:00', enabled: true, onTemperature: 82 }, temperatures: { '02:00': 70 } },
  };
  const next = nextBedEvent(schedule, 'UTC', moment.utc('2026-09-28T01:00:00Z'));
  expect(next?.at.toISOString()).toBe('2026-09-28T02:00:00.000Z');
  expect(next?.temperature).toBe(70);
});

it('does not advertise a disabled night', () => {
  const schedule = {
    monday: { power: { on: '21:00', off: '09:00', enabled: false, onTemperature: 82 }, temperatures: {} },
  };
  expect(nextBedEvent(schedule, 'UTC', moment.utc('2026-09-28T20:00:00Z'))).toBeUndefined();
});

it('finds the next scheduled power off past intervening adjustments', () => {
  const schedule = {
    sunday: { power: { on: '21:00', off: '09:00', enabled: true, onTemperature: 82 }, temperatures: { '02:00': 70 } },
  };
  const next = nextBedEvent(schedule, 'UTC', moment.utc('2026-09-28T01:00:00Z'), 'off');
  expect(next?.kind).toBe('off');
  expect(next?.at.toISOString()).toBe('2026-09-28T09:00:00.000Z');
});
