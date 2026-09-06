import { describe, it, expect } from 'vitest';
import moment from 'moment-timezone';
import { computeProjectedCurve } from './projection';
import type { Schedules } from '@api/schedulesSchema.ts';

const TZ = 'America/New_York';
const at = (iso: string) => moment.tz(iso, TZ).valueOf();

// Minimal DailySchedule; only power.on + temperatures matter for projection.
const day = (temps: Record<string, number>, powerOn = '21:00') => ({
  temperatures: temps,
  alarm: { time: '07:00', vibrationIntensity: 50, vibrationPattern: 'rise', duration: 60, enabled: false, alarmTemperature: 82 },
  alarms: [],
  power: { on: powerOn, off: '07:00', onTemperature: 82, enabled: true },
});

// Build a Schedules where every day shares the same daily schedule.
const uniformSchedules = (temps: Record<string, number>, powerOn = '21:00'): Schedules => {
  const side = {
    sunday: day(temps, powerOn),
    monday: day(temps, powerOn),
    tuesday: day(temps, powerOn),
    wednesday: day(temps, powerOn),
    thursday: day(temps, powerOn),
    friday: day(temps, powerOn),
    saturday: day(temps, powerOn),
  };
  return { left: side, right: side } as unknown as Schedules;
};

describe('computeProjectedCurve', () => {
  it('returns empty when the side has no setpoints', () => {
    const from = at('2026-03-02T22:00:00');
    const out = computeProjectedCurve(uniformSchedules({}), 'left', TZ, from, from + 6 * 3600e3);
    expect(out).toEqual([]);
  });

  it('returns empty for an inverted window', () => {
    const from = at('2026-03-02T22:00:00');
    const out = computeProjectedCurve(uniformSchedules({ '22:00': 90 }), 'left', TZ, from, from - 1000);
    expect(out).toEqual([]);
  });

  it('emits the active setpoint at `from` then each future step', () => {
    // Setpoints: 21:00 -> 100, 23:00 -> 82, 05:00 (next day) -> 90.
    const schedules = uniformSchedules({ '21:00': 100, '23:00': 82, '05:00': 90 }, '21:00');
    const from = at('2026-03-02T22:00:00'); // Monday 22:00, inside the 21:00 setpoint
    const to = at('2026-03-03T07:00:00'); // Tuesday 07:00
    const out = computeProjectedCurve(schedules, 'left', TZ, from, to);

    // First point at `from` carries the 21:00 setpoint value (100).
    expect(out[0]).toEqual({ ts: from, targetF: 100 });
    // Then the 23:00 step (82) and the 05:00-next-day step (90).
    const values = out.map((p) => p.targetF);
    expect(values).toEqual([100, 82, 90]);
    // 05:00 setpoint resolves to the NEXT calendar day (before power.on 21:00).
    const last = out[out.length - 1];
    expect(moment.tz(last.ts, TZ).format('YYYY-MM-DD HH:mm')).toBe('2026-03-03 05:00');
  });

  it('handles a setpoint exactly at `from`', () => {
    const schedules = uniformSchedules({ '22:00': 88 }, '21:00');
    const from = at('2026-03-02T22:00:00');
    const to = at('2026-03-03T07:00:00');
    const out = computeProjectedCurve(schedules, 'left', TZ, from, to);
    // The 22:00 setpoint is active at `from`, so exactly one point at from=88.
    expect(out).toEqual([{ ts: from, targetF: 88 }]);
  });

  it('spillover: a late evening setpoint from the previous day covers after-midnight `from`', () => {
    // Only one setpoint at 22:00 -> 95. `from` is 01:00 (after midnight), so the
    // active setpoint comes from the previous calendar day.
    const schedules = uniformSchedules({ '22:00': 95 }, '21:00');
    const from = at('2026-03-03T01:00:00'); // Tuesday 01:00
    const to = at('2026-03-03T07:00:00');
    const out = computeProjectedCurve(schedules, 'left', TZ, from, to);
    expect(out).toEqual([{ ts: from, targetF: 95 }]);
  });

  it('curve begins at the first future step when no earlier setpoint exists', () => {
    // Non-uniform: only Monday has a setpoint (23:00 -> 84); the prior day
    // (Sunday) has none, so nothing is active at `from` = Monday 21:30.
    const emptyDay = day({}, '21:00');
    const mondayDay = day({ '23:00': 84 }, '21:00');
    const side = {
      sunday: emptyDay, monday: mondayDay, tuesday: emptyDay, wednesday: emptyDay,
      thursday: emptyDay, friday: emptyDay, saturday: emptyDay,
    };
    const schedules = { left: side, right: side } as unknown as Schedules;
    const from = at('2026-03-02T21:30:00'); // Monday 21:30
    const to = at('2026-03-03T07:00:00');
    const out = computeProjectedCurve(schedules, 'left', TZ, from, to);
    expect(out.length).toBe(1);
    expect(out[0].targetF).toBe(84);
    expect(moment.tz(out[0].ts, TZ).format('HH:mm')).toBe('23:00');
  });

  it('only includes steps within [from, to]', () => {
    const schedules = uniformSchedules({ '21:00': 100, '23:00': 82, '05:00': 90 }, '21:00');
    const from = at('2026-03-02T22:00:00');
    const to = at('2026-03-02T23:30:00'); // window ends before the 05:00 step
    const out = computeProjectedCurve(schedules, 'left', TZ, from, to);
    const values = out.map((p) => p.targetF);
    expect(values).toEqual([100, 82]); // no 90
  });
});
