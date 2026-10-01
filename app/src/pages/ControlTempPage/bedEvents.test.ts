import { expect, it } from 'vitest';
import moment from 'moment-timezone';
import { nextBedEvent, weeklyAlarmInstants, weeklySkips } from './bedEvents';
import { skipLine } from './sleepEvents';

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

it('has no upcoming event when the Pod has no time zone, because it schedules nothing then', () => {
  const schedule = {
    sunday: { power: { on: '21:00', off: '09:00', enabled: true, onTemperature: 82 }, temperatures: {} },
  };
  expect(nextBedEvent(schedule, null as unknown as string)).toBeUndefined();
});

const alarm = { time: '06:30', enabled: true, vibrationIntensity: 30, vibrationPattern: 'rise' as const, duration: 30, alarmTemperature: 83 };
const night = (temperatures: Record<string, number> = {}) =>
  ({ power: { on: '22:00', off: '07:00', enabled: true, onTemperature: 82 }, temperatures, alarm, alarms: [alarm] });
// Monday 8:00 PM.
const MONDAY_8PM = moment.utc('2026-09-28T20:00:00Z');

it('lists the weekend alarm a week-long pause silences', () => {
  const skips = weeklySkips({ saturday: night() }, 'UTC', MONDAY_8PM, MONDAY_8PM.clone().add(7, 'days'));
  expect(skips.map(({ at, kind }) => `${at.toISOString()} ${kind}`)).toEqual([
    '2026-10-03T22:00:00.000Z start',
    '2026-10-04T06:30:00.000Z alarm',
    '2026-10-04T07:00:00.000Z turn off',
  ]);
  expect(skipLine(skips, MONDAY_8PM)).toBe('Skips: Sat 10:00 PM start, Sun 6:30 AM alarm, Sun 7:00 AM turn off');
});

it('scans the whole pause however many set points each night has', () => {
  const temperatures = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`23:${String(index * 2).padStart(2, '0')}`, 70]));
  const schedule = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    .map(day => [day, night(temperatures)]));
  const skips = weeklySkips(schedule, 'UTC', MONDAY_8PM, MONDAY_8PM.clone().add(14, 'days'));
  expect(skips.filter(skip => skip.kind === 'alarm')).toHaveLength(14);
  expect(skips.filter(skip => skip.kind === 'start')).toHaveLength(14);
  expect(skips[skips.length - 1].at.toISOString()).toBe('2026-10-12T07:00:00.000Z');
});

it('finds weekly alarms across a window of any length', () => {
  const instants = (days: number) => weeklyAlarmInstants({ sunday: night() }, 'UTC', MONDAY_8PM, MONDAY_8PM.clone().add(days, 'days'));
  expect(instants(2)).toEqual([]);
  expect(instants(14).map(instant => new Date(instant).toISOString())).toEqual(['2026-10-05T06:30:00.000Z', '2026-10-12T06:30:00.000Z']);
});
