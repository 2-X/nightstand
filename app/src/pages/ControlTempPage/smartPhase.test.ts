import { expect, it } from 'vitest';
import moment from 'moment-timezone';
import type { CurvePoint } from '@api/smartCurve';
import type { ResolvedSleepResponse } from '@api/rhythmsResponse';
import { smartLineForSleep, smartPhaseLine } from './smartPhase';

const TZ = 'America/Los_Angeles';
const at = (date: string, time: string) => moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', TZ).toDate();
const points: CurvePoint[] = [
  { at: at('2026-09-28', '22:15'), level: 2, phase: 'prewarm' },
  { at: at('2026-09-28', '22:45'), level: 2, phase: 'bedtime' },
  { at: at('2026-09-28', '23:25'), level: 1, phase: 'cooldown' },
  { at: at('2026-09-28', '23:40'), level: 0, phase: 'cooldown' },
  { at: at('2026-09-28', '23:55'), level: -1, phase: 'cooldown' },
  { at: at('2026-09-29', '00:10'), level: -2, phase: 'hold' },
  { at: at('2026-09-29', '05:45'), level: -2, phase: 'warmup' },
  { at: at('2026-09-29', '05:56'), level: -1, phase: 'warmup' },
  { at: at('2026-09-29', '06:07'), level: 0, phase: 'warmup' },
  { at: at('2026-09-29', '06:18'), level: 1, phase: 'warmup' },
  { at: at('2026-09-29', '06:30'), level: 2, phase: 'wake' },
  { at: at('2026-09-29', '07:00'), level: 0, phase: 'after' },
];
const base = { points, wake: at('2026-09-29', '06:30'), timeZone: TZ, format: 'level' as const, waiting: false, runtime: 'live' as const };
const line = (date: string, time: string, extra: Partial<Parameters<typeof smartPhaseLine>[0]> = {}) =>
  smartPhaseLine({ ...base, now: at(date, time), ...extra });

it('describes the pre-warm and the cool-down with its target and time', () => {
  expect(line('2026-09-28', '22:20')).toBe('Warming to +2 for bedtime at 10:45 PM');
  expect(line('2026-09-28', '22:50')).toBe('Cooling step by step to \u22122 by 12:10 AM');
  expect(line('2026-09-28', '23:30')).toBe('Cooling step by step to \u22122 by 12:10 AM');
});

it('announces the warm-up before it starts and while it runs', () => {
  expect(line('2026-09-29', '03:00')).toBe('Warm-up starts at 5:45 AM for your 6:30 AM wake-up');
  expect(line('2026-09-29', '06:00')).toBe('Warming step by step for your 6:30 AM wake-up');
  expect(line('2026-09-29', '06:40')).toBe('Back to 0 at 7:00 AM');
});

it('waits for bed entry while the server holds the cool-down for confirmed presence', () => {
  expect(line('2026-09-28', '23:00', { waiting: true })).toBe("Starts cooling once you've settled in bed");
  expect(line('2026-09-28', '23:30', { waiting: false })).toBe('Cooling step by step to \u22122 by 12:10 AM');
});

it('shows a manual hold until the next phase starts', () => {
  const held = (date: string, time: string, until: Date, waiting = false) =>
    line(date, time, { waiting, hold: { level: 1, until } });
  expect(held('2026-09-28', '22:20', at('2026-09-28', '23:25'))).toBe('Holding +1 until the cool-down at 11:25 PM');
  expect(held('2026-09-28', '22:50', at('2026-09-29', '00:55'), true))
    .toBe("Holding +1 until the cool-down, which starts once you've settled in bed");
  expect(held('2026-09-28', '23:30', at('2026-09-29', '00:10'))).toBe('Holding +1 until 12:10 AM, then \u22122 for the night');
  expect(held('2026-09-29', '05:30', at('2026-09-29', '05:45'))).toBe('Holding +1 until the warm-up at 5:45 AM');
  expect(held('2026-09-29', '06:00', at('2026-09-29', '06:30'))).toBe('Holding +1 until your 6:30 AM wake-up');
  // The bedtime point belongs to the pre-warm stretch, so its hold also ends at the cool-down.
  expect(held('2026-09-28', '22:50', at('2026-09-28', '23:25'))).toBe('Holding +1 until the cool-down at 11:25 PM');
  // Three hours come first.
  expect(held('2026-09-29', '01:00', at('2026-09-29', '04:00'))).toBe('Holding +1 until 4:00 AM');
  // So does the power off.
  expect(held('2026-09-29', '06:35', at('2026-09-29', '06:45'))).toBe('Holding +1 until 6:45 AM');
});

it('says when the curve went back to the base', () => {
  expect(line('2026-09-29', '06:00', { base: { level: 0, since: at('2026-09-29', '05:50') } })).toBe('Back at your base, 0, since 5:50 AM');
});

it('holds without a warm-up when it is off, and says nothing outside the curve', () => {
  expect(smartPhaseLine({ ...base, points: points.filter(point => point.phase !== 'warmup'), now: at('2026-09-29', '03:00') }))
    .toBe('Holding \u22122 until 6:30 AM');
  expect(line('2026-09-28', '21:00')).toBeUndefined();
  expect(line('2026-09-29', '07:30')).toBeUndefined();
});

it('builds the line for a resolved Smart Schedule sleep from the shared curve', () => {
  const alarm = { time: '06:30', enabled: true, vibrationIntensity: 30, vibrationPattern: 'rise' as const, duration: 30, alarmTemperature: 83 };
  const sleep: ResolvedSleepResponse = {
    side: 'left', date: '2026-09-28', rhythmId: 'workday', mode: 'smart',
    start: at('2026-09-28', '22:30').toISOString(), end: at('2026-09-29', '06:45').toISOString(), wake: at('2026-09-29', '06:30').toISOString(),
    night: { power: { on: '22:30', off: '06:45', onTemperature: 83, enabled: true }, temperatures: {}, alarm, alarms: [alarm] },
    smart: { baseLevel: 0, intensity: 'standard', warmStart: true, warmUp: true, upEarly: false },
    events: [{ kind: 'alarm', at: at('2026-09-29', '06:30').toISOString(), alarm, index: 0 }],
  };
  const options = { timeZone: TZ, format: 'level' as const, waiting: false, runtime: 'live' as const };
  expect(smartLineForSleep(sleep, { ...options, now: at('2026-09-29', '03:00') })).toMatch(/^Warm-up starts at .* for your 6:30 AM wake-up$/);
  expect(smartLineForSleep({ ...sleep, mode: 'manual' }, { ...options, now: at('2026-09-29', '03:00') })).toBeUndefined();
  // A cool-down the server delayed from 22:30 to 23:00 reaches the hold 30 minutes later than the clock curve.
  expect(smartLineForSleep(sleep, { ...options, now: at('2026-09-28', '23:05') })).toBe('Cooling step by step to \u22122 by 11:40 PM');
  expect(smartLineForSleep(sleep, { ...options, now: at('2026-09-28', '23:05'), coolStart: at('2026-09-28', '23:00') }))
    .toBe('Cooling step by step to \u22122 by 12:10 AM');
});

it('keeps only lines about later clock times while the server has not said what tonight is doing', () => {
  const unknown = { runtime: 'unknown' as const };
  expect(line('2026-09-28', '22:20', unknown)).toBeUndefined();
  expect(line('2026-09-28', '22:50', unknown)).toBeUndefined();
  expect(line('2026-09-28', '23:30', unknown)).toBeUndefined();
  expect(line('2026-09-29', '03:00', unknown)).toBe('Warm-up starts at 5:45 AM for your 6:30 AM wake-up');
  expect(line('2026-09-29', '06:00', unknown)).toBeUndefined();
  expect(line('2026-09-29', '06:40', unknown)).toBe('Back to 0 at 7:00 AM');
  // Whether the night already reached its hold depends on when the cool-down started.
  expect(smartPhaseLine({ ...base, ...unknown, points: points.filter(point => point.phase !== 'warmup'), now: at('2026-09-29', '03:00') }))
    .toBeUndefined();
  expect(line('2026-09-28', '23:30', { ...unknown, hold: { level: 1, until: at('2026-09-29', '00:10') } })).toBeUndefined();
  expect(line('2026-09-29', '06:00', { ...unknown, base: { level: 0, since: at('2026-09-29', '05:50') } })).toBeUndefined();
});
