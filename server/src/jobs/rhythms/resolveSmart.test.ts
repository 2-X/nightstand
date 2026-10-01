import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import moment from 'moment-timezone';
import type { DailySchedule } from '../../db/schedulesSchema.js';
import {
  DEFAULT_SMART, RHYTHMS_FILE_VERSION, type Rhythm, type RhythmsDB, type SideRhythms,
} from '../../db/rhythmsSchema.js';
import { wakeFromNight } from '../../db/rhythmWake.js';
import { findOverlaps, resolveSleeps, type RhythmEvent } from './resolve.js';

const TZ = 'America/Los_Angeles';
const local = (text: string) => moment.tz(text, 'YYYY-MM-DD HH:mm', TZ).toDate();
const NO_WEEK: SideRhythms['week'] = {
  sunday: null, monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null,
};

function night(on: string, off: string, alarmTime: string | null): DailySchedule {
  return {
    temperatures: { '01:00': 70 },
    alarm: {
      time: alarmTime ?? '06:30', enabled: alarmTime !== null, alarmTemperature: 82,
      vibrationIntensity: 50, vibrationPattern: 'rise', duration: 60,
    },
    alarms: [],
    power: { on, off, onTemperature: 80, enabled: true },
  };
}

function rhythm(id: string, schedule: DailySchedule, temperatureMode: Rhythm['temperatureMode']): Rhythm {
  return { id, name: id, night: schedule, wake: wakeFromNight(schedule), temperatureMode, smart: { ...DEFAULT_SMART } };
}

function sideOf(rhythms: Rhythm[], week: Partial<SideRhythms['week']>): SideRhythms {
  return { rhythms: Object.fromEntries(rhythms.map(item => [item.id, item])), week: { ...NO_WEEK, ...week }, changes: [] };
}

function dbWith(left: SideRhythms): RhythmsDB {
  return { version: RHYTHMS_FILE_VERSION, legacyFingerprint: 'a'.repeat(64), left, right: sideOf([], {}) };
}

const describeEvents = (events: RhythmEvent[]) => events.map(event => [
  moment(event.at).tz(TZ).format('HH:mm'),
  event.kind,
  'temperatureF' in event ? event.temperatureF : null,
]);

// 2026-09-29 is a Tuesday.
const TUESDAY_NIGHT = { from: local('2026-09-29 12:00'), to: local('2026-09-30 12:00') };
const workday = (mode: Rhythm['temperatureMode']) => rhythm('workday', night('22:45', '07:30', '06:30'), mode);

describe('resolveSleeps with Smart Schedule', () => {
  it('resolves a smart rhythm into the clock curve', () => {
    const db = dbWith(sideOf([workday('smart')], { tuesday: 'workday' }));
    const sleeps = resolveSleeps({ db, side: 'left', timeZone: TZ, ...TUESDAY_NIGHT });
    assert.equal(sleeps.length, 1);
    const [sleep] = sleeps;
    assert.equal(sleep.mode, 'smart');
    assert.equal(sleep.start.getTime(), local('2026-09-29 22:15').getTime());
    assert.equal(sleep.smartCurve?.bedtime.getTime(), local('2026-09-29 22:45').getTime());
    assert.deepEqual(describeEvents(sleep.events), [
      ['22:15', 'power-on', 88],
      ['22:45', 'temperature', 88],
      ['22:55', 'temperature', 88],
      ['23:10', 'temperature', 85],
      ['23:25', 'temperature', 83],
      ['23:40', 'temperature', 80],
      ['23:55', 'temperature', 77],
      ['05:45', 'temperature', 77],
      ['05:56', 'temperature', 80],
      ['06:07', 'temperature', 83],
      ['06:18', 'temperature', 85],
      ['06:30', 'temperature', 88],
      ['06:30', 'alarm', null],
      ['07:00', 'temperature', 83],
      ['07:30', 'power-off', null],
    ]);
  });

  it('passes a later cool-down start through coolStartFor', () => {
    const sleeps = resolveSleeps({
      db: dbWith(sideOf([workday('smart')], { tuesday: 'workday' })),
      side: 'left',
      timeZone: TZ,
      ...TUESDAY_NIGHT,
      coolStartFor: (side, date) => (side === 'left' && date === '2026-09-29' ? local('2026-09-29 23:00') : undefined),
    });
    assert.equal(sleeps[0].smartCurve?.coolStart.getTime(), local('2026-09-29 23:00').getTime());
    const times = sleeps[0].events.filter(event => event.kind === 'temperature').map(event => moment(event.at).tz(TZ).format('HH:mm'));
    assert.deepEqual(times.slice(0, 6), ['22:45', '23:10', '23:25', '23:40', '23:55', '00:10']);
  });

  it('leaves a manual rhythm unchanged', () => {
    const db = dbWith(sideOf([workday('manual')], { tuesday: 'workday' }));
    const [sleep] = resolveSleeps({ db, side: 'left', timeZone: TZ, ...TUESDAY_NIGHT });
    assert.equal(sleep.smartCurve, undefined);
    assert.equal(sleep.start.getTime(), local('2026-09-29 22:45').getTime());
    assert.ok(sleep.events.some(event => event.kind === 'temperature' && event.temperatureF === 70));
  });

  it('counts the pre-warm when checking overlaps', () => {
    const nightShift = rhythm('night', night('22:00', '08:15', null), 'manual');
    const args = (mode: Rhythm['temperatureMode']) => ({
      db: dbWith(sideOf([nightShift, rhythm('day', night('08:30', '16:00', null), mode)], { monday: 'night', tuesday: 'day' })),
      side: 'left' as const,
      timeZone: TZ,
      from: local('2026-09-28 00:00'),
      to: local('2026-09-30 00:00'),
    });
    assert.equal(findOverlaps(args('manual')).length, 0);
    assert.equal(findOverlaps(args('smart')).length, 1);
  });
});
