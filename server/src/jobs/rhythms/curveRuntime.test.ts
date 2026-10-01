import assert from 'node:assert/strict';
import { describe, it, before, mock } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// config.ts reads DATA_FOLDER at import time, so set it before importing.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'nightstand-curve-runtime-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';

const deviceUpdates: Array<{ update: unknown; options: unknown }> = [];
// Set to make a write wait forever, like one waiting for the hardware connection.
let writesWait = false;
mock.module(new URL('../../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: {
    updateDeviceStatus: async (update: unknown, options?: unknown) => {
      deviceUpdates.push({ update, options });
      if (writesWait) await new Promise(() => {});
    },
  },
});
mock.module(new URL('../../routes/metrics/presence.js', import.meta.url).href, {
  namedExports: { getPresenceData: () => ({ left: { present: false }, right: { present: false } }) },
});

let runtime: typeof import('./curveRuntime.js');
before(async () => {
  runtime = await import('./curveRuntime.js');
});

const MINUTE = 60_000;
const summary: import('./curveController.js').SleepSummary = {
  v: 1,
  side: 'left',
  date: '2026-09-29',
  rhythmId: 'workday',
  baseLevel: 0,
  intensity: 'standard',
  daySleep: false,
  plannedBedtime: '2026-09-30T05:45:00.000Z',
  plannedCoolStart: '2026-09-30T05:45:00.000Z',
  plannedWake: '2026-09-30T13:30:00.000Z',
  powerOff: '2026-09-30T14:30:00.000Z',
  coolStart: '2026-09-30T05:45:00.000Z',
  confirmedAt: null,
  startReason: 'unknown',
  manualChanges: {},
  bedExitsLastHour: 0,
  upEarlyAt: null,
  outOfBedAt: null,
};
const readLast = (file: string) => JSON.parse(readFileSync(file, 'utf8').trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>;

describe('recordSleepHistory', () => {
  it('adds the heart rate onset estimate when vitals exist', async () => {
    const file = path.join(dataFolder, 'with-vitals.jsonl');
    const bedtime = Date.parse(summary.plannedBedtime);
    const loader = async (_side: string, from: Date) => (from.getTime() < bedtime - 2 * 60 * MINUTE
      ? Array.from({ length: 200 }, (_, index) => ({ at: bedtime - 3 * 24 * 60 * MINUTE + index * MINUTE, hr: 50 + (index % 20) }))
      : Array.from({ length: 30 }, (_, index) => ({ at: bedtime + index * MINUTE, hr: 55 })));
    await runtime.recordSleepHistory(summary, loader, file);
    const line = readLast(file);
    assert.equal(line.onsetNote, 'hr-causal');
    assert.equal(line.onsetEstimate, new Date(bedtime + 13 * MINUTE).toISOString());
    assert.equal(line.startReason, 'unknown');
  });

  it('records a note instead of an estimate without vitals', async () => {
    const file = path.join(dataFolder, 'no-vitals.jsonl');
    await runtime.recordSleepHistory(summary, async () => [], file);
    assert.deepEqual([readLast(file).onsetEstimate, readLast(file).onsetNote], [null, 'no-vitals']);
  });

  it('still records the sleep when vitals cannot be read', async () => {
    const file = path.join(dataFolder, 'vitals-error.jsonl');
    await runtime.recordSleepHistory(summary, async () => { throw new Error('database locked'); }, file);
    assert.deepEqual([readLast(file).onsetEstimate, readLast(file).onsetNote], [null, 'vitals-error']);
  });
});

describe('curveDeps', () => {
  it('writes levels as Fahrenheit through updateDeviceStatus as scheduled work', async () => {
    const deps = runtime.curveDeps(() => {});
    await deps.applyLevel('left', -2);
    assert.deepEqual(deviceUpdates.at(-1), { update: { left: { targetTemperatureF: 77 } }, options: { background: true } });
  });

  it('does not wait for a write that waits for the hardware', async () => {
    writesWait = true;
    try {
      const deps = runtime.curveDeps(() => {});
      await deps.applyLevel('right', 1);
      assert.deepEqual(deviceUpdates.at(-1), { update: { right: { targetTemperatureF: 85 } }, options: { background: true } });
    } finally {
      writesWait = false;
    }
  });

  it('has no sleeps and no pause before a plan is synced', () => {
    const deps = runtime.curveDeps(() => {});
    assert.deepEqual(deps.sleeps('left', new Date(0), new Date()), []);
    assert.equal(deps.isPaused('left', new Date()), false);
    assert.deepEqual(deps.awayMode(), { left: false, right: false });
  });
});

describe('startCurveRuntime', () => {
  it('holds manual changes only while running with a plan', async () => {
    const moment = (await import('moment-timezone')).default;
    const { default: settingsDB } = await import('../../db/settings.js');
    const { DEFAULT_SMART, RHYTHMS_FILE_VERSION } = await import('../../db/rhythmsSchema.js');
    const { smartManualChange } = await import('./curveController.js');
    await settingsDB.read();
    const settings = { ...settingsDB.data, timeZone: 'UTC' as const };
    const now = moment.utc();
    const alarm = {
      time: '06:30', enabled: false, alarmTemperature: 82, vibrationIntensity: 50, vibrationPattern: 'rise' as const, duration: 60,
    };
    const workday = {
      id: 'workday',
      name: 'Workday',
      night: {
        temperatures: {},
        alarm,
        alarms: [],
        power: {
          on: now.clone().subtract(1, 'hour').format('HH:mm'),
          off: now.clone().add(6, 'hours').format('HH:mm'),
          onTemperature: 80,
          enabled: true,
        },
      },
      wake: now.clone().add(6, 'hours').format('HH:mm'),
      temperatureMode: 'smart' as const,
      smart: { ...DEFAULT_SMART },
    };
    const everyDay = {
      sunday: 'workday', monday: 'workday', tuesday: 'workday', wednesday: 'workday',
      thursday: 'workday', friday: 'workday', saturday: 'workday',
    };
    const noWeek = { sunday: null, monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null };
    const db: import('../../db/rhythmsSchema.js').RhythmsDB = {
      version: RHYTHMS_FILE_VERSION,
      legacyFingerprint: 'a'.repeat(64),
      left: { rhythms: { workday }, week: everyDay, changes: [] },
      right: { rhythms: {}, week: noWeek, changes: [] },
    };

    runtime.startCurveRuntime();
    runtime.syncCurvePlan(settings, db);
    try {
      assert.equal(smartManualChange('left'), 'held');
    } finally {
      runtime.stopCurveRuntime();
    }
    assert.equal(smartManualChange('left'), 'not-smart');
  });
});
