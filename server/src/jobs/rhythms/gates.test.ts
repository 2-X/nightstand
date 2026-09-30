import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Settings } from '../../db/settingsSchema.js';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-rhythm-gates-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const { default: settingsDB } = await import('../../db/settings.js');
const { default: schedulesDB } = await import('../../db/schedules.js');
const { resolveSleeps } = await import('./resolve.js');
const { everyNight, testNight, testRhythmsDB } = await import('./testSupport.js');
const { isAlarmOverridden, rhythmSkipReason } = await import('./gates.js');

const NIGHT_START = new Date('2026-09-28T23:00:00Z');
const sleep = resolveSleeps({
  db: testRhythmsDB(schedulesDB.data, everyNight(testNight('22:00', '06:00', { alarms: ['05:45'] }))),
  side: 'left', timeZone: 'UTC', from: NIGHT_START, to: NIGHT_START,
})[0];
const DURING = new Date('2026-09-29T05:45:00Z');
const RUNNING_KINDS = ['power-on', 'temperature', 'alarm', 'power-off'] as const;

function settings(configure?: (value: Settings) => void): Settings {
  const value = structuredClone(settingsDB.data);
  value.timeZone = 'UTC';
  for (const side of ['left', 'right'] as const) {
    value[side].awayMode = false;
    value[side].alarmsEnabled = true;
    value[side].scheduleOverrides = {
      temperatureSchedules: { disabled: false, expiresAt: '' },
      alarm: { disabled: false, timeOverride: '', expiresAt: '' },
      pause: { active: false, expiresAt: '' },
    };
  }
  configure?.(value);
  return value;
}

describe('rhythmSkipReason', () => {
  it('runs every kind for a present side', () => {
    for (const kind of [...RUNNING_KINDS, 'analysis'] as const) {
      assert.equal(rhythmSkipReason(settings(), 'left', sleep, kind, DURING), null, kind);
    }
  });

  it('ignores an away side and lets the present side drive', () => {
    const awayLeft = settings(value => { value.left.awayMode = true; });
    for (const kind of [...RUNNING_KINDS, 'analysis'] as const) {
      assert.equal(rhythmSkipReason(awayLeft, 'left', sleep, kind, DURING), 'away', kind);
    }
    const awayRight = settings(value => { value.right.awayMode = true; });
    assert.equal(rhythmSkipReason(awayRight, 'left', sleep, 'power-on', DURING), null);
  });

  it('holds everything but analysis while paused', () => {
    const paused = settings(value => { value.left.scheduleOverrides.pause = { active: true, expiresAt: '' }; });
    for (const kind of RUNNING_KINDS) {
      assert.equal(rhythmSkipReason(paused, 'left', sleep, kind, DURING), 'paused', kind);
    }
    assert.equal(rhythmSkipReason(paused, 'left', sleep, 'analysis', DURING), null);
    const ended = settings(value => { value.left.scheduleOverrides.pause = { active: true, expiresAt: '2026-09-29T05:00:00+00:00' }; });
    assert.equal(rhythmSkipReason(ended, 'left', sleep, 'power-off', DURING), null);
  });

  it('silences an alarm due exactly at the end of a pause but not the events that run from that instant', () => {
    const endsAtSix = settings(value => { value.left.scheduleOverrides.pause = { active: true, expiresAt: '2026-09-29T06:00:00+00:00' }; });
    const END = new Date('2026-09-29T06:00:00Z');
    const RUNS_LATE = new Date('2026-09-29T06:00:02Z');
    // The job starts two seconds after the alarm was due; it is judged at the due time.
    assert.equal(rhythmSkipReason(endsAtSix, 'left', sleep, 'alarm', RUNS_LATE, END), 'paused');
    assert.equal(rhythmSkipReason(endsAtSix, 'left', sleep, 'alarm', RUNS_LATE, new Date('2026-09-29T06:01:00Z')), null);
    assert.equal(rhythmSkipReason(endsAtSix, 'left', sleep, 'power-off', END), null);
    assert.equal(rhythmSkipReason(endsAtSix, 'left', sleep, 'temperature', END), null);
    assert.equal(rhythmSkipReason(endsAtSix, 'left', sleep, 'power-on', END), null);
  });

  it('skips alarms when the side has alarms off or an override', () => {
    const alarmsOff = settings(value => { value.left.alarmsEnabled = false; });
    assert.equal(rhythmSkipReason(alarmsOff, 'left', sleep, 'alarm', DURING), 'alarms-off');
    assert.equal(rhythmSkipReason(alarmsOff, 'left', sleep, 'power-on', DURING), null);
    const overridden = settings(value => {
      value.left.scheduleOverrides.alarm = { disabled: true, timeOverride: '', expiresAt: '2026-09-29T07:00:00+00:00' };
    });
    assert.equal(rhythmSkipReason(overridden, 'left', sleep, 'alarm', DURING), 'alarm-override');
    assert.equal(rhythmSkipReason(overridden, 'left', sleep, 'power-off', DURING), null);
  });
});

describe('isAlarmOverridden', () => {
  const withOverride = (expiresAt: string) => settings(value => {
    value.left.scheduleOverrides.alarm = { disabled: false, timeOverride: '05:00', expiresAt };
  });

  it('honours an override that has not expired', () => {
    assert.equal(isAlarmOverridden(withOverride('2026-09-29T07:00:00+00:00'), 'left', sleep, DURING), true);
  });

  it('keeps suppressing after a replacement expired inside this sleep', () => {
    assert.equal(isAlarmOverridden(withOverride('2026-09-29T05:02:00+00:00'), 'left', sleep, DURING), true);
  });

  it('ignores an override from an earlier night', () => {
    assert.equal(isAlarmOverridden(withOverride('2026-09-28T07:00:00+00:00'), 'left', sleep, DURING), false);
  });

  it('has no effect without an override', () => {
    assert.equal(isAlarmOverridden(settings(), 'left', sleep, DURING), false);
  });
});
