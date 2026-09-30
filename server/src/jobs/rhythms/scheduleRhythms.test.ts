import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, it, mock, type TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import schedule from 'node-schedule';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-schedule-rhythms-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const updates: unknown[] = [];
const commands: unknown[][] = [];
mock.module(new URL('../../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: { updateDeviceStatus: async (value: unknown) => { updates.push(value); } },
});
mock.module(new URL('../../8sleep/deviceApi.js', import.meta.url).href, {
  namedExports: { executeFunction: async (...args: unknown[]) => { commands.push(args); } },
});
mock.module(new URL('../../8sleep/frankenServer.js', import.meta.url).href, {
  namedExports: {
    connectFrankenWithin: async () => ({ getDeviceStatus: async () => ({ left: { isOn: true }, right: { isOn: true } }) }),
    getDeviceStatusCoalesced: async () => ({ left: { isOn: true }, right: { isOn: true } }),
  },
});
const analyses: string[][] = [];
mock.module(new URL('../analyzeSleep.js', import.meta.url).href, {
  namedExports: { executeAnalyzeSleep: (...args: string[]) => { analyses.push(args); } },
});

const { default: settingsDB } = await import('../../db/settings.js');
const { default: schedulesDB } = await import('../../db/schedules.js');
const { default: servicesDB } = await import('../../db/services.js');
const { default: memoryDB } = await import('../../db/memoryDB.js');
const { everyNight, testNight, testRhythmsDB } = await import('./testSupport.js');
const { scheduleRhythms } = await import('./scheduleRhythms.js');
const { abortAlarmWaits, resetAlarmActivity } = await import('../alarmActivity.js');
const { resetPowerOnTimes } = await import('../powerScheduler.js');

const NIGHT = testNight('22:00', '06:00', { temperatures: { '02:00': 72 }, alarms: ['05:45'] });
const at = (iso: string) => new Date(iso);
const setNow = (iso: string) => mock.timers.setTime(Date.parse(iso));
const rhythmNames = () => Object.keys(schedule.scheduledJobs).filter(name => name.startsWith('rhythm')).sort();
const fireTime = (name: string) => {
  const job = schedule.scheduledJobs[name];
  const next = job?.nextInvocation();
  assert.ok(next, `missing job ${name}`);
  return new Date(next.getTime()).toISOString();
};
const sleepJobs = (date: string) => [
  'alarm-0545-0', 'analysis-0615-0', 'analysis-0800-1', 'power-off-0600-0', 'power-on-2200-0', 'temperature-0200-0',
].map(suffix => `rhythm-left-${date}-${suffix}`);

beforeEach(async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T12:00:00Z') });
  updates.length = 0;
  commands.length = 0;
  analyses.length = 0;
  servicesDB.data.biometrics.enabled = true;
  await servicesDB.write();
  memoryDB.data.left = { isAlarmVibrating: false, analyzeSleep: {} };
  memoryDB.data.right = { isAlarmVibrating: false, analyzeSleep: {} };
  await memoryDB.write();
  settingsDB.data.timeZone = 'UTC';
  for (const side of ['left', 'right'] as const) {
    settingsDB.data[side].awayMode = false;
    settingsDB.data[side].alarmsEnabled = true;
    settingsDB.data[side].scheduleOverrides = {
      temperatureSchedules: { disabled: false, expiresAt: '' },
      alarm: { disabled: false, timeOverride: '', expiresAt: '' },
      pause: { active: false, expiresAt: '' },
    };
  }
  await settingsDB.write();
});

afterEach(() => {
  Object.keys(schedule.scheduledJobs).forEach(name => schedule.cancelJob(name));
  resetAlarmActivity();
  resetPowerOnTimes();
  mock.timers.reset();
});
after(() => rmSync(folder, { recursive: true, force: true }));

it('plans each sleep in the 48 hour horizon once', () => {
  const { jobCount } = scheduleRhythms(settingsDB.data, testRhythmsDB(schedulesDB.data, everyNight(NIGHT)), at('2026-09-28T12:00:00Z'));
  assert.equal(jobCount, 12);
  assert.deepEqual(rhythmNames(), [...sleepJobs('2026-09-28'), ...sleepJobs('2026-09-29'), 'rhythms-horizon']);
  assert.equal(fireTime('rhythm-left-2026-09-28-power-on-2200-0'), '2026-09-28T22:00:00.000Z');
  assert.equal(fireTime('rhythm-left-2026-09-28-temperature-0200-0'), '2026-09-29T02:00:00.000Z');
  assert.equal(fireTime('rhythm-left-2026-09-28-analysis-0615-0'), '2026-09-29T06:15:00.000Z');
  assert.equal(fireTime('rhythm-left-2026-09-28-analysis-0800-1'), '2026-09-29T08:00:00.000Z');
  assert.equal(fireTime('rhythm-left-2026-09-29-power-off-0600-0'), '2026-09-30T06:00:00.000Z');
});

it('extends the horizon every hour without duplicating jobs', async () => {
  const db = testRhythmsDB(schedulesDB.data, everyNight(NIGHT));
  scheduleRhythms(settingsDB.data, db, at('2026-09-28T12:00:00Z'));
  assert.equal(scheduleRhythms(settingsDB.data, db, at('2026-09-28T12:00:00Z')).jobCount, 0);
  setNow('2026-09-29T12:00:00Z');
  await schedule.scheduledJobs['rhythms-horizon'].invoke();
  assert.ok(rhythmNames().includes('rhythm-left-2026-09-30-power-on-2200-0'));
  assert.equal(rhythmNames().filter(name => name.includes('2026-09-28')).length, 6);
});

it('plans only what is still ahead for a sleep in progress', () => {
  setNow('2026-09-29T01:00:00Z');
  const { jobCount } = scheduleRhythms(settingsDB.data, testRhythmsDB(schedulesDB.data, everyNight(NIGHT)), at('2026-09-29T01:00:00Z'));
  assert.equal(jobCount, 17);
  assert.deepEqual(rhythmNames().filter(name => name.includes('2026-09-28')), sleepJobs('2026-09-28')
    .filter(name => !name.includes('power-on')));
});

it('keeps both end-of-sleep analyses for a sleep that just ended', () => {
  setNow('2026-09-29T06:05:00Z');
  scheduleRhythms(settingsDB.data, testRhythmsDB(schedulesDB.data, everyNight(NIGHT)), at('2026-09-29T06:05:00Z'));
  assert.deepEqual(rhythmNames().filter(name => name.includes('2026-09-28')), [
    'rhythm-left-2026-09-28-analysis-0615-0',
    'rhythm-left-2026-09-28-analysis-0800-1',
  ]);
});

it('keeps only the two hour re-analysis once the first one has run', () => {
  setNow('2026-09-29T06:20:00Z');
  scheduleRhythms(settingsDB.data, testRhythmsDB(schedulesDB.data, everyNight(NIGHT)), at('2026-09-29T06:20:00Z'));
  assert.deepEqual(rhythmNames().filter(name => name.includes('2026-09-28')), ['rhythm-left-2026-09-28-analysis-0800-1']);
});

it('re-analyses over the 25 hours before end plus two hours, in the same queue as the first run', async () => {
  scheduleRhythms(settingsDB.data, testRhythmsDB(schedulesDB.data, everyNight(NIGHT)), at('2026-09-28T12:00:00Z'));
  setNow('2026-09-29T06:15:00Z');
  await schedule.scheduledJobs['rhythm-left-2026-09-28-analysis-0615-0'].invoke();
  setNow('2026-09-29T08:00:00Z');
  await memoryDB.read();
  // The queue itself skips an overlapping call; this only clears the 10 minute repeat guard.
  memoryDB.data.left.analyzeSleep = {};
  await memoryDB.write();
  await schedule.scheduledJobs['rhythm-left-2026-09-28-analysis-0800-1'].invoke();
  assert.deepEqual(analyses, [
    ['left', '2026-09-28T21:00:00.000Z', '2026-09-29T07:00:00.000Z'],
    ['left', '2026-09-28T07:00:00.000Z', '2026-09-29T08:00:00.000Z'],
  ]);
});

it("lets the present side drive and ignores an away side's rhythm", () => {
  const db = testRhythmsDB(schedulesDB.data, everyNight(NIGHT), everyNight(testNight('08:00', '16:00')));
  settingsDB.data.right.awayMode = true;
  scheduleRhythms(settingsDB.data, db, at('2026-09-28T12:00:00Z'));
  assert.equal(rhythmNames().some(name => name.startsWith('rhythm-right')), false);
  assert.equal(rhythmNames().filter(name => name.startsWith('rhythm-left')).length, 12);
  Object.keys(schedule.scheduledJobs).forEach(name => schedule.cancelJob(name));
  settingsDB.data.right.awayMode = false;
  settingsDB.data.left.awayMode = true;
  scheduleRhythms(settingsDB.data, db, at('2026-09-28T12:00:00Z'));
  assert.equal(rhythmNames().some(name => name.startsWith('rhythm-left')), false);
  assert.ok(rhythmNames().some(name => name.startsWith('rhythm-right')));
});

it('leaves out alarms when the side has alarms off', () => {
  settingsDB.data.left.alarmsEnabled = false;
  scheduleRhythms(settingsDB.data, testRhythmsDB(schedulesDB.data, everyNight(NIGHT)), at('2026-09-28T12:00:00Z'));
  assert.equal(rhythmNames().some(name => name.includes('-alarm-')), false);
});

it('still fires a temperature stored after the power off, as the weekly engine does', () => {
  setNow('2026-09-29T08:00:00Z');
  const late = testNight('22:00', '06:00', { temperatures: { '10:00': 70 } });
  scheduleRhythms(settingsDB.data, testRhythmsDB(schedulesDB.data, everyNight(late)), at('2026-09-29T08:00:00Z'));
  assert.equal(fireTime('rhythm-left-2026-09-28-temperature-1000-0'), '2026-09-29T10:00:00.000Z');
});

it('fires at the right instants and sets the firmware across the fall back night', async () => {
  settingsDB.data.timeZone = 'America/Los_Angeles';
  await settingsDB.write();
  setNow('2026-10-31T19:00:00Z');
  const db = testRhythmsDB(schedulesDB.data, everyNight(testNight('22:00', '06:00', { temperatures: { '01:30': 70 } })));
  scheduleRhythms(settingsDB.data, db, at('2026-10-31T19:00:00Z'));
  assert.equal(fireTime('rhythm-left-2026-10-31-power-on-2200-0'), '2026-11-01T05:00:00.000Z');
  assert.equal(fireTime('rhythm-left-2026-10-31-temperature-0130-0'), '2026-11-01T08:30:00.000Z');
  assert.equal(fireTime('rhythm-left-2026-10-31-power-off-0600-0'), '2026-11-01T14:00:00.000Z');
  setNow('2026-11-01T05:00:00Z');
  await schedule.scheduledJobs['rhythm-left-2026-10-31-power-on-2200-0'].invoke();
  assert.deepEqual(updates, [{ left: { isOn: true, targetTemperatureF: 80, secondsRemaining: 9 * 3600 + 300 } }]);
});

it('moves a missing time forward and sets the firmware across the spring forward night', async () => {
  settingsDB.data.timeZone = 'America/Los_Angeles';
  await settingsDB.write();
  setNow('2026-03-07T20:00:00Z');
  const db = testRhythmsDB(schedulesDB.data, everyNight(testNight('22:00', '06:00', { temperatures: { '02:30': 70 } })));
  scheduleRhythms(settingsDB.data, db, at('2026-03-07T20:00:00Z'));
  assert.equal(fireTime('rhythm-left-2026-03-07-power-on-2200-0'), '2026-03-08T06:00:00.000Z');
  assert.equal(fireTime('rhythm-left-2026-03-07-temperature-0330-0'), '2026-03-08T10:30:00.000Z');
  assert.equal(fireTime('rhythm-left-2026-03-07-power-off-0600-0'), '2026-03-08T13:00:00.000Z');
  setNow('2026-03-08T06:00:00Z');
  await schedule.scheduledJobs['rhythm-left-2026-03-07-power-on-2200-0'].invoke();
  assert.deepEqual(updates, [{ left: { isOn: true, targetTemperatureF: 80, secondsRemaining: 7 * 3600 + 300 } }]);
});

it('logs a job that fails instead of rejecting, which would stop the server', async t => {
  scheduleRhythms(settingsDB.data, testRhythmsDB(schedulesDB.data, everyNight(NIGHT)), at('2026-09-28T12:00:00Z'));
  t.mock.method(settingsDB, 'read', async () => { throw new Error('read failed'); });
  for (const suffix of ['power-on-2200-0', 'alarm-0545-0', 'analysis-0615-0']) {
    await assert.doesNotReject(async () => { await schedule.scheduledJobs[`rhythm-left-2026-09-28-${suffix}`].invoke(); });
  }
});

it('logs a horizon run that fails instead of throwing', () => {
  const db = testRhythmsDB(schedulesDB.data, everyNight(NIGHT));
  scheduleRhythms(settingsDB.data, db, at('2026-09-28T12:00:00Z'));
  db.left.changes = null as unknown as typeof db.left.changes;
  assert.doesNotThrow(() => schedule.scheduledJobs['rhythms-horizon'].invoke());
});

// Captures timers so a test can end an alarm's ring on cue.
function captureTimers(t: TestContext) {
  const timers: { callback: () => void; ms: number }[] = [];
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, ms: number) => {
    timers.push({ callback, ms });
    return { unref() {} } as unknown as NodeJS.Timeout;
  });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  return timers;
}
const WAKE_AT_OFF = testNight('22:00', '06:00', { alarms: ['06:00'] });
const settle = () => new Promise(resolve => setImmediate(resolve));

it('lets an alarm due with the power-off ring before the side turns off', async t => {
  const timers = captureTimers(t);
  scheduleRhythms(settingsDB.data, testRhythmsDB(schedulesDB.data, everyNight(WAKE_AT_OFF)), at('2026-09-28T12:00:00Z'));
  setNow('2026-09-29T06:00:00Z');
  // node-schedule may start the power-off first.
  const powerOff = schedule.scheduledJobs['rhythm-left-2026-09-28-power-off-0600-0'].invoke() as unknown as Promise<number>;
  await settle();
  assert.deepEqual(updates, [], 'the side turned off before the alarm could ring');
  await schedule.scheduledJobs['rhythm-left-2026-09-28-alarm-0600-0'].invoke();
  assert.equal(commands.filter(([command]) => command === 'ALARM_LEFT').length, 1);
  for (let turn = 0; turn < 5 && updates.length === 0; turn++) {
    await settle();
    timers.filter(timer => timer.ms === 20_000).forEach(timer => timer.callback());
  }
  await powerOff;
  assert.deepEqual(updates, [{ left: { isOn: false } }]);
});

it('ends the wait for a ringing alarm at shutdown so the side turns off at once', async t => {
  captureTimers(t);
  scheduleRhythms(settingsDB.data, testRhythmsDB(schedulesDB.data, everyNight(WAKE_AT_OFF)), at('2026-09-28T12:00:00Z'));
  setNow('2026-09-29T06:00:00Z');
  const powerOff = schedule.scheduledJobs['rhythm-left-2026-09-28-power-off-0600-0'].invoke() as unknown as Promise<number>;
  await schedule.scheduledJobs['rhythm-left-2026-09-28-alarm-0600-0'].invoke();
  await settle();
  assert.deepEqual(updates, []);
  abortAlarmWaits();
  await powerOff;
  assert.deepEqual(updates, [{ left: { isOn: false } }]);
});
