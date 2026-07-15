import assert from 'node:assert/strict';
import { describe, it, before, beforeEach } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import moment from 'moment-timezone';

// Same isolated-temp-DATA_FOLDER pattern as db/services.test.ts: config.ts
// reads DATA_FOLDER at import time, so this must be set before the dynamic
// imports below, and a fresh dir keeps this test off any real DB on disk.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-schedule-override-test-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';

let settingsDB: typeof import('../db/settings.js')['default'];
let schedulesDB: typeof import('../db/schedules.js')['default'];
let markManualTempChange: typeof import('./scheduleOverride.js')['markManualTempChange'];
let isTempScheduleOverridden: typeof import('./scheduleOverride.js')['isTempScheduleOverridden'];
let OVERRIDE_DURATION_HOURS: typeof import('./scheduleOverride.js')['OVERRIDE_DURATION_HOURS'];

before(async () => {
  ({ default: settingsDB } = await import('../db/settings.js'));
  ({ default: schedulesDB } = await import('../db/schedules.js'));
  ({ markManualTempChange, isTempScheduleOverridden, OVERRIDE_DURATION_HOURS } = await import('./scheduleOverride.js'));
});

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

// Seeds a single temperature entry on the left side at `hoursFromNow`,
// wherever that lands relative to the real clock (today or tomorrow), so
// findNextScheduledTempChange's own today/tomorrow walk has exactly one
// candidate to find.
async function setNextScheduledChange(hoursFromNow: number) {
  await schedulesDB.read();
  const target = moment.tz('UTC').add(hoursFromNow, 'hours');
  const dayName = DAY_NAMES[target.day()];
  schedulesDB.data.left[dayName].temperatures = { [target.format('HH:mm')]: 75 };
  await schedulesDB.write();
}

beforeEach(async () => {
  await settingsDB.read();
  settingsDB.data.timeZone = 'UTC';
  settingsDB.data.left.scheduleOverrides.temperatureSchedules = { disabled: false, expiresAt: '' };
  await settingsDB.write();

  await schedulesDB.read();
  for (const day of DAY_NAMES) {
    schedulesDB.data.left[day].temperatures = {};
  }
  await schedulesDB.write();
});

describe('markManualTempChange', () => {
  it('pauses the schedule when the next change is within the override window', async () => {
    await setNextScheduledChange(1); // 1h away, inside the 3h window
    await markManualTempChange('left');

    await settingsDB.read();
    assert.equal(settingsDB.data.left.scheduleOverrides.temperatureSchedules.disabled, true);
    assert.equal(isTempScheduleOverridden('left'), true);
  });

  it('does not pause the schedule when the next change is outside the window', async () => {
    await setNextScheduledChange(5); // 5h away, outside the 3h window
    await markManualTempChange('left');

    await settingsDB.read();
    assert.equal(settingsDB.data.left.scheduleOverrides.temperatureSchedules.disabled, false);
  });

  it('does nothing when there is no upcoming scheduled change', async () => {
    await markManualTempChange('left');

    await settingsDB.read();
    assert.equal(settingsDB.data.left.scheduleOverrides.temperatureSchedules.disabled, false);
  });

  it('sets an expiresAt roughly OVERRIDE_DURATION_HOURS in the future', async () => {
    await setNextScheduledChange(1);
    await markManualTempChange('left');

    await settingsDB.read();
    const expiresAt = moment(settingsDB.data.left.scheduleOverrides.temperatureSchedules.expiresAt);
    const expectedExpiry = moment().add(OVERRIDE_DURATION_HOURS, 'hours');
    assert.ok(Math.abs(expiresAt.diff(expectedExpiry, 'minutes')) < 2);
  });

  it('only affects the requested side', async () => {
    await setNextScheduledChange(1);
    await markManualTempChange('left');

    await settingsDB.read();
    assert.equal(settingsDB.data.right.scheduleOverrides.temperatureSchedules.disabled, false);
  });
});

describe('isTempScheduleOverridden', () => {
  it('returns false when disabled is false', () => {
    assert.equal(isTempScheduleOverridden('left'), false);
  });

  it('returns false when expiresAt is in the past', async () => {
    await settingsDB.read();
    settingsDB.data.left.scheduleOverrides.temperatureSchedules = {
      disabled: true,
      expiresAt: moment().subtract(1, 'hour').format(),
    };
    await settingsDB.write();

    assert.equal(isTempScheduleOverridden('left'), false);
  });

  it('returns true when disabled and expiresAt is in the future', async () => {
    await settingsDB.read();
    settingsDB.data.left.scheduleOverrides.temperatureSchedules = {
      disabled: true,
      expiresAt: moment().add(1, 'hour').format(),
    };
    await settingsDB.write();

    assert.equal(isTempScheduleOverridden('left'), true);
  });
});
