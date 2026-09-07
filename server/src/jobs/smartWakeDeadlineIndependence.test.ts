import assert from 'node:assert/strict';
import { describe, it, before, after, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodeSchedule from 'node-schedule';

// HARD GUARANTEE test: the deadline alarm job must be armed even when the
// smart-wake session machinery fails outright.
//
// We attack the coupling two ways:
//   1) the smart-wake controller entry points throw, and
//   2) scheduling the *-smartwake node-schedule job itself throws synchronously
//      (simulating a scheduler-level failure during session arming).
// In both cases the deadline node-schedule job (`${side}-recurring-${id}`) must
// still end up scheduled.
//
// Isolated-temp-DATA_FOLDER pattern, mirroring jobSchedulerClock.test.ts.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-smartwake-indep-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';

// Wrap node-schedule so scheduling any *-smartwake job throws synchronously,
// while every other job (crucially the deadline `*-recurring-*` job) schedules
// for real. This directly exercises the try/catch that keeps the deadline
// independent of session arming.
const realScheduleJob = nodeSchedule.scheduleJob.bind(nodeSchedule);
let breakSmartWakeScheduling = false;
mock.method(nodeSchedule, 'scheduleJob', (...args: unknown[]) => {
  const name = typeof args[0] === 'string' ? args[0] : undefined;
  if (breakSmartWakeScheduling && name && name.endsWith('-smartwake')) {
    throw new Error('smartwake scheduleJob boom');
  }
  // @ts-expect-error - forwarding the original variadic overloads
  return realScheduleJob(...args);
});

// Make the smart-wake controller explode on every call too. If the deadline
// job's scheduling were coupled to the session, this would take the alarm down.
mock.module(new URL('../8sleep/smartWakeController.js', import.meta.url).href, {
  namedExports: {
    startSmartWakeSession: async () => { throw new Error('session start boom'); },
    stopSmartWakeSession: () => { throw new Error('session stop boom'); },
    notifySmartWakeDismissed: () => {},
    stopAllSmartWakeSessions: () => {},
  },
});

// updateDeviceStatus pulls in franken; stub it so importing the scheduler graph
// doesn't require hardware.
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: { updateDeviceStatus: async () => {} },
});

// armVibe would try to spawn python; stub to a no-op.
mock.module(new URL('./armVibe.js', import.meta.url).href, {
  namedExports: { armVibe: async () => {} },
});

let scheduleRecurringAlarms: typeof import('./alarmScheduler.js')['scheduleRecurringAlarms'];
let recurringAlarmsDB: typeof import('../db/recurringAlarms.js')['default'];
let settingsDB: typeof import('../db/settings.js')['default'];

before(async () => {
  ({ scheduleRecurringAlarms } = await import('./alarmScheduler.js'));
  ({ default: recurringAlarmsDB } = await import('../db/recurringAlarms.js'));
  ({ default: settingsDB } = await import('../db/settings.js'));

  await settingsDB.read();
  settingsDB.data.timeZone = 'America/New_York';
  settingsDB.data.left.awayMode = false;
  settingsDB.data.left.alarmsEnabled = true;
  await settingsDB.write();
});

after(() => {
  Object.keys(nodeSchedule.scheduledJobs).forEach((name) => nodeSchedule.cancelJob(name));
});

describe('smart-wake deadline independence', () => {
  it('arms the deadline alarm job even when the smart-wake session throws', async () => {
    const alarmId = 'indep-1';
    await recurringAlarmsDB.read();
    recurringAlarmsDB.data.left = [
      {
        id: alarmId,
        time: '07:00',
        recurrence: { kind: 'daily' },
        vibration: { intensity: 60, duration: 90, pattern: 'rise' },
        // Smart wake ON with a wide window, so the (failing) session-start job
        // is definitely attempted.
        smartWake: { enabled: true, windowMinutes: 30 },
        enabled: true,
      },
    ];
    recurringAlarmsDB.data.right = [];
    recurringAlarmsDB.data._migrated = true;
    await recurringAlarmsDB.write();

    await settingsDB.read();
    // Arm. scheduleSmartWakeSession will run and its scheduled callback throws
    // when it fires, but even the synchronous scheduling path must not stop the
    // deadline job from being armed.
    scheduleRecurringAlarms(settingsDB.data, 'left');

    const deadlineJob = nodeSchedule.scheduledJobs[`left-recurring-${alarmId}`];
    assert.ok(deadlineJob, 'deadline alarm job was not armed despite smart-wake failure');
  });

  it('arms the deadline even when scheduling the smart-wake job throws synchronously', async () => {
    breakSmartWakeScheduling = true;
    const alarmId = 'indep-2';
    await recurringAlarmsDB.read();
    recurringAlarmsDB.data.left = [
      {
        id: alarmId,
        time: '07:30',
        recurrence: { kind: 'daily' },
        vibration: { intensity: 50, duration: 60, pattern: 'double' },
        smartWake: { enabled: true, windowMinutes: 60 },
        enabled: true,
      },
    ];
    recurringAlarmsDB.data._migrated = true;
    await recurringAlarmsDB.write();

    await settingsDB.read();
    // The *-smartwake scheduleJob will throw; the deadline *-recurring- job must
    // still be armed by the same armNextRecurringOccurrence call.
    scheduleRecurringAlarms(settingsDB.data, 'left');
    assert.ok(
      nodeSchedule.scheduledJobs[`left-recurring-${alarmId}`],
      'deadline alarm job missing after a synchronous smart-wake scheduling failure',
    );
    assert.equal(
      nodeSchedule.scheduledJobs[`left-recurring-${alarmId}-smartwake`],
      undefined,
      'the smart-wake job should NOT be armed (its scheduling threw)',
    );
    breakSmartWakeScheduling = false;
  });
});
