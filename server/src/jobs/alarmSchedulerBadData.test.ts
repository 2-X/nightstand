import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import schedule from 'node-schedule';

const dataFolder = mkdtempSync(path.join(tmpdir(), 'nightstand-alarm-nan-probe-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';

let scheduleAlarm: typeof import('./alarmScheduler.js')['scheduleAlarm'];
let settingsDB: typeof import('../db/settings.js')['default'];
let DailySchedule: unknown;

before(async () => {
  ({ scheduleAlarm } = await import('./alarmScheduler.js'));
  ({ default: settingsDB } = await import('../db/settings.js'));
  await settingsDB.read();
  settingsDB.data.timeZone = 'UTC';
  settingsDB.data.left.alarmsEnabled = true;
  settingsDB.data.left.awayMode = false;
  await settingsDB.write();
});

after(async () => {
  await schedule.gracefulShutdown();
});

// A day schedule exactly as POST /schedules persists it when the body carries
// an alarm entry with no `time` (see routes/schedules/schedulesApi.probe.test.ts).
const dayScheduleWithTimelessAlarm = {
  temperatures: {},
  power: { on: '21:00', off: '09:00', enabled: true, onTemperature: 82 },
  alarm: { enabled: true },
  alarms: [{ enabled: true }],
} as unknown as import('../db/schedulesSchema.js').DailySchedule;

const goodDaySchedule = {
  temperatures: {},
  power: { on: '21:00', off: '09:00', enabled: true, onTemperature: 82 },
  alarm: {
    time: '07:00', vibrationIntensity: 100, vibrationPattern: 'rise', duration: 10, enabled: true, alarmTemperature: 82,
  },
  alarms: [{
    time: '07:00', vibrationIntensity: 100, vibrationPattern: 'rise', duration: 10, enabled: true, alarmTemperature: 82,
  }],
} as unknown as import('../db/schedulesSchema.js').DailySchedule;

void DailySchedule;

describe('scheduleAlarm with a persisted timeless alarm ', () => {
  it('does not throw when a stored alarm has no time', () => {
    assert.doesNotThrow(() => {
      scheduleAlarm(settingsDB.data, 'left', 'monday', dayScheduleWithTimelessAlarm);
    });
  });

  it('still schedules the remaining days after a bad one, the way setupJobs iterates', () => {
    // setupJobs() loops every side x day inside a single try/catch. A throw in
    // one day aborts the whole loop, so every later day (and the prime/reboot
    // jobs after it) never get registered.
    const days: Array<[string, import('../db/schedulesSchema.js').DailySchedule]> = [
      ['monday', dayScheduleWithTimelessAlarm],
      ['tuesday', goodDaySchedule],
    ];
    let scheduledDays = 0;
    try {
      days.forEach(([day, daySchedule]) => {
        scheduleAlarm(settingsDB.data, 'left', day as 'monday', daySchedule);
        scheduledDays += 1;
      });
    } catch {
      // swallowed here the way setupJobs swallows it
    }
    assert.equal(scheduledDays, 2, 'a single malformed day aborted the whole job-setup loop');
  });
});
