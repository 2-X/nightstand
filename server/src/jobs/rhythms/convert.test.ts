import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DailySchedule, Schedules } from '../../db/schedulesSchema.js';
import { DEFAULT_SMART, SideRhythms, SideRhythmsSchema } from '../../db/rhythmsSchema.js';
import { convertLegacy, uniqueRhythmId } from './convert.js';
import { ResolvedSleep, resolveLegacySleeps, resolveSleeps } from './resolve.js';
import { alarmAt, dbOf, nightOf, schedulesOf, WORKDAY } from './rhythmsTestData.js';

const WEEKEND_NIGHT = nightOf({ on: '23:30', off: '09:00', temperatures: { '02:00': 76 } });
const everyDay = <T>(value: T) => ({
  sunday: value, monday: value, tuesday: value, wednesday: value, thursday: value, friday: value, saturday: value,
});
const alarmsOf = (...alarms: DailySchedule['alarms']) => ({ alarm: alarms[0], alarms });
const namesOf = (side: SideRhythms) => Object.values(side.rhythms).map(rhythm => [rhythm.id, rhythm.name]).sort();

describe('convertLegacy', () => {
  it('turns seven identical nights into one rhythm called Every night', () => {
    const { left } = convertLegacy(schedulesOf(everyDay(WORKDAY)));
    assert.deepEqual(Object.keys(left.rhythms), ['every-night']);
    assert.equal(left.rhythms['every-night'].name, 'Every night');
    assert.deepEqual(left.week, everyDay('every-night'));
    assert.deepEqual(left.changes, []);
  });

  it('names Sunday to Thursday Weeknights and other groups after their days', () => {
    const { left } = convertLegacy(schedulesOf({
      sunday: WORKDAY, monday: WORKDAY, tuesday: WORKDAY, wednesday: WORKDAY, thursday: WORKDAY,
      friday: WEEKEND_NIGHT, saturday: WEEKEND_NIGHT,
    }));
    assert.deepEqual(namesOf(left), [['fri-and-sat', 'Fri and Sat'], ['weeknights', 'Weeknights']]);
    assert.deepEqual(left.week, {
      sunday: 'weeknights', monday: 'weeknights', tuesday: 'weeknights', wednesday: 'weeknights',
      thursday: 'weeknights', friday: 'fri-and-sat', saturday: 'fri-and-sat',
    });
  });

  it('reads Monday to Friday and the weekend as their days', () => {
    const { left } = convertLegacy(schedulesOf({
      monday: WORKDAY, tuesday: WORKDAY, wednesday: WORKDAY, thursday: WORKDAY, friday: WORKDAY,
      saturday: WEEKEND_NIGHT, sunday: WEEKEND_NIGHT,
    }));
    assert.deepEqual(namesOf(left), [['mon-to-fri', 'Mon to Fri'], ['sat-and-sun', 'Sat and Sun']]);
  });

  it('names a single day after that day and plans no sleep on disabled days', () => {
    const late = nightOf({ on: '23:00', off: '08:00' });
    const { left } = convertLegacy(schedulesOf({
      sunday: WORKDAY, monday: WORKDAY, tuesday: WORKDAY, wednesday: WORKDAY, thursday: WORKDAY, friday: late,
      saturday: { ...late, power: { ...late.power, enabled: false } },
    }));
    assert.deepEqual(Object.values(left.rhythms).map(rhythm => [rhythm.id, rhythm.name]), [
      ['weeknights', 'Weeknights'], ['friday', 'Friday'],
    ]);
    assert.equal(left.week.thursday, 'weeknights');
    assert.equal(left.week.friday, 'friday');
    assert.equal(left.week.saturday, null);
  });

  it('groups the single alarm form with the alarms list form of the same night', () => {
    const single = { ...WORKDAY, alarm: alarmAt('06:30'), alarms: [] };
    const { left } = convertLegacy(schedulesOf({ monday: WORKDAY, tuesday: single }));
    assert.deepEqual(Object.keys(left.rhythms), ['mon-and-tue']);
    assert.deepEqual(left.rhythms['mon-and-tue'].night.alarms, [alarmAt('06:30')]);
    assert.equal(left.week.tuesday, 'mon-and-tue');
  });

  it('keeps each night\'s wake time: its earliest enabled alarm, else its turn off', () => {
    const quiet = nightOf({ on: '22:00', off: '07:15', alarms: [alarmAt('06:00', { enabled: false })] });
    const { left } = convertLegacy(schedulesOf({ monday: WORKDAY, friday: quiet }));
    assert.equal(left.rhythms.monday.wake, '06:30');
    assert.equal(left.rhythms.friday.wake, '07:15');
  });

  it('starts every rhythm set by hand with the default Smart Schedule settings', () => {
    const { right } = convertLegacy(schedulesOf({}, { monday: WORKDAY }));
    const rhythm = right.rhythms.monday;
    assert.equal(rhythm.temperatureMode, 'manual');
    assert.deepEqual(rhythm.smart, DEFAULT_SMART);
    rhythm.smart.baseLevel = 3;
    assert.equal(DEFAULT_SMART.baseLevel, 0, 'each rhythm gets its own copy');
  });

  it('produces sides that pass the strict schema even when days carry unknown keys', () => {
    const future = { ...WORKDAY, futureDay: { kept: true } } as typeof WORKDAY;
    const converted = convertLegacy(schedulesOf({ monday: future }, { friday: WORKDAY }));
    assert.equal(SideRhythmsSchema.safeParse(converted.left).success, true);
    assert.equal(SideRhythmsSchema.safeParse(converted.right).success, true);
  });

  it('does not share objects with the weekly schedule', () => {
    const schedules = schedulesOf({ monday: WORKDAY });
    const { left } = convertLegacy(schedules);
    left.rhythms.monday.night.temperatures['23:00'] = 60;
    left.rhythms.monday.night.alarms[0].time = '05:00';
    assert.equal(schedules.left.monday.temperatures['23:00'], 78);
    assert.equal(schedules.left.monday.alarms[0].time, '06:30');
  });
});

// Nights with the same power times as WORKDAY that differ in one thing only.
const LOOKALIKES: Record<string, DailySchedule> = {
  'alarm time': { ...WORKDAY, ...alarmsOf(alarmAt('06:45')) },
  'alarm vibration': { ...WORKDAY, ...alarmsOf(alarmAt('06:30', { vibrationIntensity: 40 })) },
  'alarm pattern': { ...WORKDAY, ...alarmsOf(alarmAt('06:30', { vibrationPattern: 'double' })) },
  'alarm duration': { ...WORKDAY, ...alarmsOf(alarmAt('06:30', { duration: 10 })) },
  'alarm temperature': { ...WORKDAY, ...alarmsOf(alarmAt('06:30', { alarmTemperature: 70 })) },
  temperatures: { ...WORKDAY, temperatures: { '23:00': 78, '03:00': 72 } },
  'turn on temperature': { ...WORKDAY, power: { ...WORKDAY.power, onTemperature: 80 } },
  'a disabled alarm': { ...WORKDAY, ...alarmsOf(alarmAt('06:30'), alarmAt('05:00', { enabled: false })) },
};

describe('convertLegacy equivalence', () => {
  for (const [difference, night] of Object.entries(LOOKALIKES)) {
    it(`keeps nights apart that differ only in ${difference}`, () => {
      const { left } = convertLegacy(schedulesOf({ monday: WORKDAY, tuesday: night }));
      assert.equal(Object.keys(left.rhythms).length, 2);
      assert.notEqual(left.week.monday, left.week.tuesday);
    });
  }

  it('leaves a disabled day out of the group of the same night', () => {
    const off = { ...WORKDAY, power: { ...WORKDAY.power, enabled: false } };
    const { left } = convertLegacy(schedulesOf({ monday: WORKDAY, tuesday: off, wednesday: WORKDAY }));
    assert.deepEqual(Object.values(left.rhythms).map(rhythm => rhythm.name), ['Mon and Wed']);
    assert.equal(left.week.tuesday, null);
  });

  it('resolves to the same sleeps as the weekly schedule it came from', () => {
    const late = nightOf({ on: '23:00', off: '08:00', alarms: [alarmAt('07:15')] });
    const lookalikes = Object.values(LOOKALIKES);
    const cases: Schedules[] = [
      schedulesOf(
        { sunday: WORKDAY, monday: WORKDAY, tuesday: late, thursday: late, friday: WEEKEND_NIGHT, saturday: WEEKEND_NIGHT },
        { monday: late, wednesday: WORKDAY },
      ),
      schedulesOf(
        { sunday: WORKDAY, monday: lookalikes[0], tuesday: lookalikes[1], wednesday: lookalikes[2], thursday: lookalikes[3],
          friday: lookalikes[4], saturday: lookalikes[5] },
        { sunday: lookalikes[7], monday: lookalikes[6], tuesday: WORKDAY, wednesday: lookalikes[5], thursday: lookalikes[3],
          friday: lookalikes[2], saturday: lookalikes[0] },
      ),
    ];
    // The first window crosses the spring-forward night, the second the fall-back night.
    const windows = [['2026-03-01T00:00:00Z', '2026-03-29T00:00:00Z'], ['2026-10-25T00:00:00Z', '2026-11-15T00:00:00Z']];
    // The weekly schedule has no rhythm ids or Smart Schedule settings to compare.
    const plain = (sleeps: ResolvedSleep[]) => sleeps.map(sleep => ({ ...sleep, rhythmId: null, smart: undefined }));
    for (const schedules of cases) {
      const converted = convertLegacy(schedules);
      const db = dbOf(converted.left, converted.right);
      for (const [start, end] of windows) {
        for (const side of ['left', 'right'] as const) {
          const args = { side, timeZone: 'America/Los_Angeles', from: new Date(start), to: new Date(end) };
          const legacy = resolveLegacySleeps({ schedules, ...args });
          assert.ok(legacy.length > 0);
          assert.deepEqual(plain(resolveSleeps({ db, ...args })), plain(legacy));
        }
      }
    }
  });
});

describe('uniqueRhythmId', () => {
  it('slugs the name and adds a number when the id is taken', () => {
    const used = new Set<string>();
    assert.equal(uniqueRhythmId('Every night', used), 'every-night');
    assert.equal(uniqueRhythmId('Every night', used), 'every-night-2');
    assert.equal(uniqueRhythmId('every night!', used), 'every-night-3');
    assert.equal(uniqueRhythmId('***', used), 'rhythm');
  });

  it('keeps ids within 32 characters', () => {
    const used = new Set<string>();
    const name = 'a'.repeat(40);
    assert.equal(uniqueRhythmId(name, used), 'a'.repeat(32));
    assert.equal(uniqueRhythmId(name, used), `${'a'.repeat(30)}-2`);
  });
});
