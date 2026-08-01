import assert from 'node:assert/strict';
import { describe, it, beforeEach, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// config.ts reads DATA_FOLDER at import time and the schedulers pull in the
// lowdb-backed settings/schedules modules, so this has to run before the
// dynamic imports below. Fresh temp dir keeps it off any real DB.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-scheduler-daymath-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';

import type { DailySchedule, DayOfWeek, Side, Time } from '../db/schedulesSchema.js';
import type { Settings } from '../db/settingsSchema.js';

// Real RecurrenceRule, fake scheduleJob: this test only needs the rule that
// each scheduler builds, never an actual firing.
const realSchedule = (await import('node-schedule')).default;

type Captured = { name: string; rule: InstanceType<typeof realSchedule.RecurrenceRule> | Date };
const captured: Captured[] = [];

const scheduleJobMock = mock.fn((name: string, rule: unknown) => {
  captured.push({ name, rule: rule as Captured['rule'] });
  return null;
});

mock.module('node-schedule', {
  defaultExport: {
    RecurrenceRule: realSchedule.RecurrenceRule,
    scheduleJob: scheduleJobMock,
    scheduledJobs: {},
    cancelJob: () => true,
    gracefulShutdown: async () => {},
  },
});

const { schedulePowerOn, schedulePowerOff } = await import('./powerScheduler.js');
const { scheduleTemperatures } = await import('./temperatureScheduler.js');
const { scheduleAlarm } = await import('./alarmScheduler.js');
const { schedulePrimingRebootAndCalibration } = await import('./primeScheduler.js');
const { DAYS_OF_WEEK } = await import('./utils.js');

const TZ = 'America/Los_Angeles';

const settings = (overrides: Partial<Settings> = {}): Settings => ({
  timeZone: TZ,
  left: { awayMode: false, alarmsEnabled: true },
  right: { awayMode: false, alarmsEnabled: true },
  primePodDaily: { enabled: false, time: '14:00' },
  ...overrides,
} as unknown as Settings);

const dailySchedule = (over: {
  on: Time; off: Time; temperatures?: Record<string, number>; alarmTime?: Time;
}): DailySchedule => ({
  temperatures: over.temperatures ?? {},
  power: { on: over.on, off: over.off, onTemperature: 82, enabled: true },
  alarm: {
    time: over.alarmTime ?? '06:30',
    vibrationIntensity: 100,
    vibrationPattern: 'rise',
    duration: 60,
    enabled: over.alarmTime !== undefined,
    alarmTemperature: 82,
  },
  alarms: [],
});

const WEEK = 7 * 1440;
const abs = (dayIndex: number, hour: number, minute: number) => dayIndex * 1440 + hour * 60 + minute;

type Rule = { dayOfWeek: number; hour: number; minute: number; tz: string };
const ruleOf = (nameFragment: string): Rule => {
  const hit = captured.find((c) => c.name.includes(nameFragment));
  assert.ok(hit, `no job scheduled matching "${nameFragment}" (scheduled: ${captured.map((c) => c.name).join(', ')})`);
  return hit!.rule as unknown as Rule;
};
const absOf = (r: Rule) => abs(r.dayOfWeek, r.hour, r.minute);
const minutesAfter = (a: number, b: number) => ((a - b) % WEEK + WEEK) % WEEK;
const pad = (n: number) => String(n).padStart(2, '0');
const describeRule = (r: Rule) => `${DAYS_OF_WEEK[r.dayOfWeek] ?? r.dayOfWeek} ${pad(r.hour)}:${pad(r.minute)}`;

const side: Side = 'left';

beforeEach(() => {
  captured.length = 0;
});

describe('power on / power off land on a consistent pair of days', () => {
  const cases: { label: string; day: DayOfWeek; on: Time; off: Time }[] = [
    { label: 'ordinary night', day: 'monday', on: '21:00', off: '09:00' },
    { label: 'weekend sleep-in to 13:00', day: 'saturday', on: '23:00', off: '13:00' },
    { label: 'after-midnight bedtime', day: 'monday', on: '00:30', off: '08:00' },
    { label: 'morning nap', day: 'monday', on: '09:00', off: '11:00' },
    { label: 'afternoon nap', day: 'monday', on: '13:00', off: '15:00' },
  ];

  cases.forEach(({ label, day, on, off }) => {
    it(`${label} (${on} -> ${off} on ${day}): off fires after on, within 24h`, () => {
      const s = settings();
      const sched = dailySchedule({ on, off });
      schedulePowerOn(s, side, day, sched.power);
      schedulePowerOff(s, side, day, sched.power);

      const onRule = ruleOf('power-on');
      const offRule = ruleOf('power-off');
      const delta = minutesAfter(absOf(offRule), absOf(onRule));

      assert.ok(
        delta > 0 && delta <= 1440,
        `power on ${describeRule(onRule)} -> power off ${describeRule(offRule)} = ${(delta / 60).toFixed(1)}h of heating`,
      );
    });
  });
});

describe('temperature adjustments land inside their own power window', () => {
  it('22:00 -> 13:00 with a 03:00 adjustment', () => {
    const day: DayOfWeek = 'monday';
    const s = settings();
    const sched = dailySchedule({ on: '22:00', off: '13:00', temperatures: { '03:00': 75 } });

    schedulePowerOn(s, side, day, sched.power);
    schedulePowerOff(s, side, day, sched.power);
    scheduleTemperatures(s, side, day, sched.temperatures, sched.power);

    const onRule = ruleOf('power-on');
    const offRule = ruleOf('power-off');
    const tempRule = ruleOf('temperature-adjustment');

    const offDelta = minutesAfter(absOf(offRule), absOf(onRule));
    const tempDelta = minutesAfter(absOf(tempRule), absOf(onRule));

    assert.ok(
      tempDelta > 0 && tempDelta <= offDelta && offDelta <= 1440,
      `power on ${describeRule(onRule)}, power off ${describeRule(offRule)}, temp adjust ${describeRule(tempRule)}`,
    );
  });

  it('09:00 -> 11:00 morning nap with a 10:00 adjustment', () => {
    const day: DayOfWeek = 'monday';
    const s = settings();
    const sched = dailySchedule({ on: '09:00', off: '11:00', temperatures: { '10:00': 75 } });

    schedulePowerOn(s, side, day, sched.power);
    scheduleTemperatures(s, side, day, sched.temperatures, sched.power);

    const onRule = ruleOf('power-on');
    const tempRule = ruleOf('temperature-adjustment');
    const tempDelta = minutesAfter(absOf(tempRule), absOf(onRule));

    assert.ok(
      tempDelta > 0 && tempDelta <= 1440,
      `power on ${describeRule(onRule)}, temp adjust ${describeRule(tempRule)} (${(tempDelta / 60).toFixed(1)}h later)`,
    );
  });
});

describe('alarms land inside their own power window', () => {
  it('ordinary night 21:00 -> 09:00 with a 06:30 alarm', () => {
    const day: DayOfWeek = 'monday';
    const s = settings();
    const sched = dailySchedule({ on: '21:00', off: '09:00', alarmTime: '06:30' });

    schedulePowerOn(s, side, day, sched.power);
    schedulePowerOff(s, side, day, sched.power);
    scheduleAlarm(s, side, day, sched);

    const onRule = ruleOf('power-on');
    const offRule = ruleOf('power-off');
    const alarmRule = ruleOf('-alarm');

    const offDelta = minutesAfter(absOf(offRule), absOf(onRule));
    const alarmDelta = minutesAfter(absOf(alarmRule), absOf(onRule));
    assert.ok(
      alarmDelta > 0 && alarmDelta <= offDelta,
      `power on ${describeRule(onRule)}, power off ${describeRule(offRule)}, alarm ${describeRule(alarmRule)}`,
    );
  });

  it('sleep-in night 22:00 -> 13:00 with a 06:30 alarm', () => {
    const day: DayOfWeek = 'monday';
    const s = settings();
    const sched = dailySchedule({ on: '22:00', off: '13:00', alarmTime: '06:30' });

    schedulePowerOn(s, side, day, sched.power);
    scheduleAlarm(s, side, day, sched);

    const onRule = ruleOf('power-on');
    const alarmRule = ruleOf('-alarm');
    const alarmDelta = minutesAfter(absOf(alarmRule), absOf(onRule));

    assert.ok(
      alarmDelta > 0 && alarmDelta <= 1440,
      `power on ${describeRule(onRule)}, alarm ${describeRule(alarmRule)} -- alarm is ${(alarmDelta / 60).toFixed(1)}h after the bed turns on`,
    );
  });

  it('alarm day is derived from the alarm time, not from power.off', () => {
    // Two schedules identical except for power.off. The alarm is the same
    // 06:30 in both, so it should be scheduled for the same weekday in both.
    const day: DayOfWeek = 'monday';
    const s = settings();

    schedulePowerOn(s, side, day, dailySchedule({ on: '22:00', off: '09:00' }).power);
    scheduleAlarm(s, side, day, dailySchedule({ on: '22:00', off: '09:00', alarmTime: '06:30' }));
    const alarmWithMorningOff = ruleOf('-alarm').dayOfWeek;

    captured.length = 0;
    scheduleAlarm(s, side, day, dailySchedule({ on: '22:00', off: '13:00', alarmTime: '06:30' }));
    const alarmWithAfternoonOff = ruleOf('-alarm').dayOfWeek;

    assert.equal(
      alarmWithAfternoonOff,
      alarmWithMorningOff,
      `a 06:30 alarm moved from ${DAYS_OF_WEEK[alarmWithMorningOff]} to ${DAYS_OF_WEEK[alarmWithAfternoonOff]} `
      + 'purely because power.off changed from 09:00 to 13:00',
    );
  });
});

describe('prime scheduler derives the reboot hour by subtracting an hour', () => {
  it('a 00:30 prime time still schedules a daily reboot (at 23:30 the day before)', () => {
    const s = settings({ primePodDaily: { enabled: true, time: '00:30' } } as unknown as Partial<Settings>);
    schedulePrimingRebootAndCalibration(s);

    const rebootJob = captured.find((c) => c.name.startsWith('daily-reboot'));
    assert.ok(rebootJob, 'no daily reboot job was scheduled at all');
    const rule = rebootJob!.rule as unknown as Rule;
    assert.ok(
      rule.hour >= 0 && rule.hour <= 23,
      `daily reboot rule has hour=${rule.hour}; node-schedule rejects it (RecurrenceRule.isValid() === false) so the reboot never fires`,
    );
    assert.equal(rule.hour, 23, 'an hour before 00:30 is 23:30');
  });

  it('a 14:00 prime time schedules the reboot at 13:00 (control)', () => {
    const s = settings({ primePodDaily: { enabled: true, time: '14:00' } } as unknown as Partial<Settings>);
    schedulePrimingRebootAndCalibration(s);
    const rebootJob = captured.find((c) => c.name.startsWith('daily-reboot'));
    assert.ok(rebootJob);
    assert.equal((rebootJob!.rule as unknown as Rule).hour, 13);
  });
});
