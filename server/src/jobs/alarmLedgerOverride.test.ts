import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import schedule from 'node-schedule';
import type { DailySchedule } from '../db/schedulesSchema.js';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-alarm-ledger-override-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const LEDGER = path.join(folder, 'alarm-ledger.json');

const { default: settingsDB } = await import('../db/settings.js');
const { default: schedulesDB } = await import('../db/schedules.js');
const ledger = await import('./alarmLedger.js');
const { scheduleAlarm } = await import('./alarmScheduler.js');
const { scheduleRhythms } = await import('./rhythms/scheduleRhythms.js');
const { everyNight, testNight, testRhythmsDB } = await import('./rhythms/testSupport.js');

const NOW = '2026-09-28T12:00:00Z';
const alarm = {
  time: '07:00', enabled: true, vibrationIntensity: 100, duration: 10, vibrationPattern: 'rise' as const, alarmTemperature: 80,
};
const night: DailySchedule = {
  power: { on: '21:00', off: '09:00', enabled: true, onTemperature: 82 },
  temperatures: {}, alarm, alarms: [alarm],
};
const planned = () => {
  ledger.startAlarmLedger(new Date(NOW));
  ledger.alarmLedgerHeartbeat(new Date(NOW));
  return (JSON.parse(readFileSync(LEDGER, 'utf8')).upcoming as { jobName: string }[]).map(item => item.jobName);
};
const override = (expiresAt: string) => {
  settingsDB.data.left.scheduleOverrides.alarm = { disabled: false, timeOverride: '07:30', expiresAt };
};

beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  settingsDB.data.timeZone = 'UTC';
  settingsDB.data.left.awayMode = false;
  settingsDB.data.left.alarmsEnabled = true;
  settingsDB.data.left.scheduleOverrides.alarm = { disabled: false, timeOverride: '', expiresAt: '' };
});
afterEach(() => {
  Object.keys(schedule.scheduledJobs).forEach(name => schedule.cancelJob(name));
  ledger.resetAlarmLedgerForTests();
  rmSync(LEDGER, { force: true });
  mock.timers.reset();
});
after(() => rmSync(folder, { recursive: true, force: true }));

describe('the weekly alarm', () => {
  it('is saved as upcoming', () => {
    scheduleAlarm(settingsDB.data, 'left', 'monday', night);
    assert.deepEqual(planned(), ['left-monday-07:00-0-alarm']);
  });
  it('is left out while an override replaces it', () => {
    override('2026-09-29T07:30:00Z');
    scheduleAlarm(settingsDB.data, 'left', 'monday', night);
    assert.ok(schedule.scheduledJobs['left-monday-07:00-0-alarm']);
    assert.deepEqual(planned(), []);
  });
});

describe('a Rhythms alarm', () => {
  const NIGHT = testNight('22:00', '06:00', { alarms: ['05:45'] });
  const plan = () => scheduleRhythms(settingsDB.data, testRhythmsDB(schedulesDB.data, everyNight(NIGHT)), new Date(NOW));
  it('is saved as upcoming', () => {
    plan();
    assert.ok(planned().includes('rhythm-left-2026-09-28-alarm-0545-0'));
  });
  it('is left out while an override replaces it', () => {
    override('2026-09-29T07:30:00Z');
    plan();
    assert.ok(schedule.scheduledJobs['rhythm-left-2026-09-28-alarm-0545-0']);
    assert.equal(planned().includes('rhythm-left-2026-09-28-alarm-0545-0'), false);
  });
});
