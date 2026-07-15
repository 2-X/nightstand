import { describe, expect, it } from 'vitest';
import moment from 'moment-timezone';

import type { DailySchedule, SideSchedule } from '@api/schedulesSchema.ts';
import { getNextScheduledTemperatureChange, getScheduledTargetTemperature } from './scheduleTemperature.ts';

const TIME_ZONE = 'America/Los_Angeles';

const disabledDay = (): DailySchedule => ({
  temperatures: {},
  alarm: {
    time: '09:00',
    enabled: false,
    vibrationIntensity: 1,
    vibrationPattern: 'rise',
    duration: 60,
    alarmTemperature: 85,
  },
  alarms: [],
  power: {
    on: '21:00',
    off: '08:00',
    onTemperature: 82,
    enabled: false,
  },
});

const buildSideSchedule = (overrides: Partial<Record<keyof SideSchedule, Partial<DailySchedule>>> = {}): SideSchedule => {
  const schedule = {
    sunday: disabledDay(),
    monday: disabledDay(),
    tuesday: disabledDay(),
    wednesday: disabledDay(),
    thursday: disabledDay(),
    friday: disabledDay(),
    saturday: disabledDay(),
  };
  for (const [day, override] of Object.entries(overrides)) {
    const base = schedule[day as keyof SideSchedule];
    schedule[day as keyof SideSchedule] = {
      ...base,
      ...override,
      power: { ...base.power, ...override.power },
    };
  }
  return schedule;
};

// 2026-07-08 is a Wednesday
const wednesdayAt = (time: string) => moment.tz(`2026-07-08 ${time}`, TIME_ZONE);
const thursdayAt = (time: string) => moment.tz(`2026-07-09 ${time}`, TIME_ZONE);

describe('getScheduledTargetTemperature', () => {
  it('returns undefined without a schedule or time zone', () => {
    expect(getScheduledTargetTemperature(undefined, TIME_ZONE)).toBeUndefined();
    expect(getScheduledTargetTemperature(buildSideSchedule(), undefined)).toBeUndefined();
  });

  it('returns undefined when no day has an enabled power schedule', () => {
    expect(getScheduledTargetTemperature(buildSideSchedule(), TIME_ZONE, wednesdayAt('19:00'))).toBeUndefined();
  });

  it('uses the upcoming power-on temperature before the schedule starts', () => {
    const schedule = buildSideSchedule({
      wednesday: { power: { on: '21:00', off: '08:00', onTemperature: 78, enabled: true } },
    });
    expect(getScheduledTargetTemperature(schedule, TIME_ZONE, wednesdayAt('19:00'))).toBe(78);
  });

  it('uses the power-on temperature inside the interval before any adjustment', () => {
    const schedule = buildSideSchedule({
      wednesday: {
        temperatures: { '23:00': 72 },
        power: { on: '21:00', off: '08:00', onTemperature: 78, enabled: true },
      },
    });
    expect(getScheduledTargetTemperature(schedule, TIME_ZONE, wednesdayAt('22:00'))).toBe(78);
  });

  it('uses the latest adjustment that has already occurred', () => {
    const schedule = buildSideSchedule({
      wednesday: {
        temperatures: { '23:00': 72, '02:00': 68 },
        power: { on: '21:00', off: '08:00', onTemperature: 78, enabled: true },
      },
    });
    expect(getScheduledTargetTemperature(schedule, TIME_ZONE, wednesdayAt('23:30'))).toBe(72);
    // Past midnight the interval still belongs to Wednesday's schedule
    expect(getScheduledTargetTemperature(schedule, TIME_ZONE, thursdayAt('03:00'))).toBe(68);
  });

  it('resolves an overnight interval from the previous day', () => {
    const schedule = buildSideSchedule({
      wednesday: { power: { on: '22:00', off: '08:00', onTemperature: 66, enabled: true } },
    });
    // 6 AM Thursday is inside Wednesday's 22:00 -> 08:00 interval
    expect(getScheduledTargetTemperature(schedule, TIME_ZONE, thursdayAt('06:00'))).toBe(66);
  });

  it('falls forward to the next enabled day when today is disabled', () => {
    const schedule = buildSideSchedule({
      friday: { power: { on: '21:00', off: '08:00', onTemperature: 70, enabled: true } },
    });
    expect(getScheduledTargetTemperature(schedule, TIME_ZONE, wednesdayAt('19:00'))).toBe(70);
  });
});

describe('getNextScheduledTemperatureChange', () => {
  it('returns the next adjustment after now', () => {
    const schedule = buildSideSchedule({
      wednesday: {
        temperatures: { '23:00': 72, '02:00': 68 },
        power: { on: '21:00', off: '08:00', onTemperature: 78, enabled: true },
      },
    });
    const next = getNextScheduledTemperatureChange(schedule, TIME_ZONE, wednesdayAt('23:30'));
    expect(next?.temperatureF).toBe(68);
    expect(next?.time).toBe('02:00');
  });

  it('returns undefined when no adjustment remains in the interval', () => {
    const schedule = buildSideSchedule({
      wednesday: {
        temperatures: { '23:00': 72 },
        power: { on: '21:00', off: '08:00', onTemperature: 78, enabled: true },
      },
    });
    expect(getNextScheduledTemperatureChange(schedule, TIME_ZONE, thursdayAt('03:00'))).toBeUndefined();
  });
});
