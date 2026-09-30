import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import moment from 'moment-timezone';
import schedule from 'node-schedule';
import type { DailySchedule } from '../db/schedulesSchema.js';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-scheduling-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const commands: unknown[][] = [];
const updates: unknown[] = [];
const analyses: string[][] = [];
mock.module(new URL('../8sleep/deviceApi.js', import.meta.url).href, {
  namedExports: { executeFunction: async (...args: unknown[]) => { commands.push(args); } },
});
let leftOn = true;
mock.module(new URL('../8sleep/frankenServer.js', import.meta.url).href, {
  namedExports: { connectFrankenWithin: async () => ({
    getDeviceStatus: async () => ({ left: { isOn: leftOn }, right: { isOn: true } }),
  }) },
});
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: { updateDeviceStatus: async (value: { left?: { isOn?: boolean } }) => {
    updates.push(value);
    if (value?.left?.isOn === false) leftOn = false;
  } },
});
mock.module(new URL('./analyzeSleep.js', import.meta.url).href, {
  namedExports: { executeAnalyzeSleep: (...args: string[]) => { analyses.push(args); } },
});
const { default: settings } = await import('../db/settings.js');
const { default: schedules } = await import('../db/schedules.js');
const { default: memory } = await import('../db/memoryDB.js');
const { default: services } = await import('../db/services.js');
let { executeAlarm, scheduleAlarm, scheduleAlarmOverride } = await import('./alarmScheduler.js');
let schedulerInstance = 0;
const { scheduleTemperatures } = await import('./temperatureScheduler.js');
const { scheduleSleepAnalysis } = await import('./powerScheduler.js');
const { markManualTempChange } = await import('./scheduleOverride.js');

const alarm = {
  time: '07:00', enabled: true, vibrationIntensity: 100,
  duration: 10, vibrationPattern: 'rise' as const, alarmTemperature: 80,
};
const night: DailySchedule = {
  power: { on: '21:00', off: '09:00', enabled: true, onTemperature: 82 },
  temperatures: {}, alarm, alarms: [alarm],
};
let now = Date.parse('2026-09-28T20:00:00Z');
const originalMomentNow = moment.now;
beforeEach(async () => {
  ({ executeAlarm, scheduleAlarm, scheduleAlarmOverride } = await import(`./alarmScheduler.js?instance=${schedulerInstance++}`));
  now = Date.parse('2026-09-28T20:00:00Z');
  moment.now = () => now;
  commands.length = 0;
  updates.length = 0;
  leftOn = true;
  analyses.length = 0;
  settings.data.timeZone = 'UTC';
  settings.data.left.awayMode = false;
  settings.data.left.alarmsEnabled = true;
  settings.data.left.scheduleOverrides = {
    alarm: { disabled: false, timeOverride: '', expiresAt: '' },
    temperatureSchedules: { disabled: false, expiresAt: '' },
  };
  await settings.write();
  memory.data.left = { isAlarmVibrating: false, analyzeSleep: {} };
  await memory.write();
  for (const day of Object.values(schedules.data.left)) {
    day.temperatures = {};
    day.power.enabled = false;
  }
  schedules.data.left.monday = structuredClone(night);
  await schedules.write();
});
afterEach(() => {
  Object.keys(schedule.scheduledJobs).forEach(name => schedule.cancelJob(name));
  moment.now = originalMomentNow;
});
after(() => rmSync(folder, { recursive: true, force: true }));

test('distinct alarms fifteen minutes apart both reach the device', async (t) => {
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', () => ({ unref() {} }) as NodeJS.Timeout);
  scheduleAlarm(settings.data, 'left', 'monday', {
    ...night, alarms: [alarm, { ...alarm, time: '07:15' }],
  });
  now = Date.parse('2026-09-29T07:00:00Z');
  await schedule.scheduledJobs['left-monday-07:00-0-alarm'].invoke();
  now += 15 * 60_000;
  await schedule.scheduledJobs['left-monday-07:15-1-alarm'].invoke();
  assert.equal(commands.length, 2);
});

test('the repeated DST wall-clock occurrence fires only once', async (t) => {
  settings.data.timeZone = 'America/Los_Angeles';
  await settings.write();
  now = Date.parse('2026-11-01T07:00:00Z');
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', () => ({ unref() {} }) as NodeJS.Timeout);
  scheduleAlarm(settings.data, 'left', 'saturday', { ...night, alarms: [{ ...alarm, time: '01:30' }] });
  now = Date.parse('2026-11-01T08:30:00Z');
  await schedule.scheduledJobs['left-saturday-01:30-0-alarm'].invoke();
  now = Date.parse('2026-11-01T09:30:00Z');
  await schedule.scheduledJobs['left-saturday-01:30-0-alarm'].invoke();
  assert.equal(commands.length, 1);
});

test('a forced alarm test does not suppress the upcoming alarm', async (t) => {
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', () => ({ unref() {} }) as NodeJS.Timeout);
  scheduleAlarm(settings.data, 'left', 'monday', night);
  now = Date.parse('2026-09-29T06:55:00Z');
  await executeAlarm({ side: 'left', ...alarm, force: true });
  now = Date.parse('2026-09-29T07:00:00Z');
  await schedule.scheduledJobs['left-monday-07:00-0-alarm'].invoke();
  assert.equal(commands.length, 2);
});

test('disabled nights do not create temperature commands', async () => {
  scheduleTemperatures(settings.data, 'left', 'monday', { '22:00': 55 }, { ...night.power, enabled: false });
  const job = schedule.scheduledJobs['left-monday-22:00-55-temperature-adjustment'];
  assert.equal(job, undefined);
  assert.deepEqual(updates, []);
});

test('a Tuesday manual change protects Monday night adjustments', async () => {
  now = Date.parse('2026-09-29T01:00:00Z');
  schedules.data.left.monday.temperatures = { '02:00': 70 };
  await schedules.write();
  await markManualTempChange('left');
  await settings.read();
  assert.equal(settings.data.left.scheduleOverrides.temperatureSchedules.disabled, true);
});

test('disabled temperature schedules do not create manual overrides', async () => {
  now = Date.parse('2026-09-28T21:00:00Z');
  schedules.data.left.monday.power.enabled = false;
  schedules.data.left.monday.temperatures = { '22:00': 70 };
  await schedules.write();
  await markManualTempChange('left');
  await settings.read();
  assert.equal(settings.data.left.scheduleOverrides.temperatureSchedules.disabled, false);
});

test('an earlier override suppresses the original alarm for that night', async (t) => {
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', () => ({ unref() {} }) as NodeJS.Timeout);
  settings.data.left.scheduleOverrides.alarm = {
    disabled: false, timeOverride: '05:00', expiresAt: '2026-09-29T05:02:00Z',
  };
  await settings.write();
  scheduleAlarmOverride(settings.data, 'left');
  scheduleAlarm(settings.data, 'left', 'monday', night);
  now = Date.parse('2026-09-29T05:00:00Z');
  await schedule.scheduledJobs['left-alarm-override-05:00'].invoke();
  now = Date.parse('2026-09-29T07:00:00Z');
  await schedule.scheduledJobs['left-monday-07:00-0-alarm'].invoke();
  assert.equal(commands.length, 1);
  now = Date.parse('2026-10-06T07:00:00Z');
  await schedule.scheduledJobs['left-monday-07:00-0-alarm'].invoke();
  assert.equal(commands.length, 2, 'an expired override must not suppress the following week');
});

test('noon analysis includes the preceding evening', async () => {
  now = Date.parse('2026-09-29T12:00:00Z');
  services.data.biometrics.enabled = true;
  await services.write();
  scheduleSleepAnalysis(settings.data, 'left');
  await schedule.scheduledJobs['daily-analyze-sleep-left'].invoke();
  assert.equal(analyses[0][1], '2026-09-28T12:00:00.000Z');
  assert.equal(analyses[0][2], '2026-09-29T13:00:00.000Z');
});

test('rebuilding after a replacement has rung cannot replay it tomorrow', t => {
  now = Date.parse('2026-09-29T06:00:00Z');
  t.mock.method(Date, 'now', () => now);
  settings.data.left.scheduleOverrides.alarm = {
    disabled: false, timeOverride: '05:00', expiresAt: '2026-09-29T09:00:00Z',
  };
  scheduleAlarmOverride(settings.data, 'left');
  assert.equal(schedule.scheduledJobs['left-alarm-override-05:00'], undefined);
});

test('an overnight replacement inherits the enabled alarm from the starting night', async t => {
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', () => ({ unref() {} }) as NodeJS.Timeout);
  schedules.data.left.monday.alarms = [
    { ...alarm, enabled: false, vibrationIntensity: 10 },
    { ...alarm, time: '07:15', vibrationIntensity: 70, duration: 20 },
  ];
  await schedules.write();
  settings.data.left.scheduleOverrides.alarm = {
    disabled: false, timeOverride: '05:00', expiresAt: '2026-09-29T09:00:00Z',
  };
  await settings.write();
  scheduleAlarmOverride(settings.data, 'left');
  now = Date.parse('2026-09-29T05:00:00Z');
  await schedule.scheduledJobs['left-alarm-override-05:00'].invoke();
  const { default: cbor } = await import('cbor');
  const payload = cbor.decodeFirstSync(Buffer.from(commands[0][1] as string, 'hex'));
  assert.equal(payload.pl, 70);
  assert.equal(payload.du, 20);
});

test('overlapping alarms retain dismissal until the latest alarm finishes', async t => {
  const timers: (() => Promise<void>)[] = [];
  t.mock.method(globalThis, 'setTimeout', (callback: () => Promise<void>) => {
    timers.push(callback);
    return { unref() {} } as NodeJS.Timeout;
  });
  await executeAlarm({ side: 'left', ...alarm, duration: 300 }, 'first');
  await executeAlarm({ side: 'left', ...alarm, duration: 300, force: true });
  await timers[0]();
  await memory.read();
  assert.equal(memory.data.left.isAlarmVibrating, true, 'an older alarm timer must not hide the later alarm');
  await timers[1]();
  await memory.read();
  assert.equal(memory.data.left.isAlarmVibrating, false);
});

test('a previous full-day override expires at the next night start', async t => {
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', () => ({ unref() {} }) as NodeJS.Timeout);
  settings.data.left.scheduleOverrides.alarm = {
    disabled: true, timeOverride: '', expiresAt: '2026-09-28T09:00:00Z',
  };
  await settings.write();
  scheduleAlarm(settings.data, 'left', 'monday', { ...night, power: { ...night.power, on: '09:00', off: '09:00' } });
  now = Date.parse('2026-09-29T07:00:00Z');
  await schedule.scheduledJobs['left-monday-07:00-0-alarm'].invoke();
  assert.equal(commands.length, 1);
});


test('a full-day replacement rebuilt after ringing cannot fire at the next night start', t => {
  now = Date.parse('2026-09-28T21:01:00Z');
  t.mock.method(Date, 'now', () => now);
  schedules.data.left.monday.power = { ...night.power, on: '21:00', off: '21:00' };
  settings.data.left.scheduleOverrides.alarm = {
    disabled: false, timeOverride: '21:00', expiresAt: '2026-09-29T21:00:00Z',
  };
  scheduleAlarmOverride(settings.data, 'left');
  assert.equal(schedule.scheduledJobs['left-alarm-override-21:00'], undefined);
});


test('toggling an earlier alarm cannot replay a later alarm after a rebuild', async t => {
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', () => ({ unref() {} }) as NodeJS.Timeout);
  const later = { ...alarm, time: '07:15' };
  scheduleAlarm(settings.data, 'left', 'monday', { ...night, alarms: [alarm, later] });
  now = Date.parse('2026-09-29T07:15:00Z');
  await schedule.scheduledJobs['left-monday-07:15-1-alarm'].invoke();
  scheduleAlarm(settings.data, 'left', 'monday', { ...night, alarms: [{ ...alarm, enabled: false }, later] });
  await schedule.scheduledJobs['left-monday-07:15-0-alarm'].invoke();
  assert.equal(commands.length, 1);
});

test('concurrent callbacks for one occurrence issue only one device command', async t => {
  t.mock.method(globalThis, 'setTimeout', () => ({ unref() {} }) as NodeJS.Timeout);
  await Promise.all([
    executeAlarm({ side: 'left', ...alarm }, 'same-occurrence'),
    executeAlarm({ side: 'left', ...alarm }, 'same-occurrence'),
  ]);
  assert.equal(commands.length, 1);
});


test('an override at exactly the turn-off minute rings once', async t => {
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', () => ({ unref() {} }) as NodeJS.Timeout);
  const wakeNight = { ...night, power: { ...night.power, off: '07:00' }, alarms: [{ ...alarm, time: '06:30' }] };
  schedules.data.left.monday = structuredClone(wakeNight);
  await schedules.write();
  now = Date.parse('2026-09-28T22:00:00Z');
  settings.data.left.scheduleOverrides.alarm = {
    disabled: false, timeOverride: '07:00', expiresAt: '2026-09-29T07:00:00Z',
  };
  await settings.write();
  scheduleAlarmOverride(settings.data, 'left');
  scheduleAlarm(settings.data, 'left', 'monday', wakeNight);
  assert.ok(schedule.scheduledJobs['left-alarm-override-07:00'], 'the override at the turn-off minute was not scheduled');
  now = Date.parse('2026-09-29T06:30:00Z');
  await schedule.scheduledJobs['left-monday-06:30-0-alarm'].invoke();
  assert.equal(commands.length, 0, 'the replaced alarm must stay silent');
  now = Date.parse('2026-09-29T07:00:00Z');
  await schedule.scheduledJobs['left-alarm-override-07:00'].invoke();
  assert.equal(commands.length, 1);
});
