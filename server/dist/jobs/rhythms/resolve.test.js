import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SMART } from '../../db/rhythmsSchema.js';
import { applyAlarmsEnabled, findOverlaps, MAX_RESOLVE_WINDOW_MS, resolveLegacySleeps, resolveSleeps, } from './resolve.js';
import { alarmAt, dbOf, nightOf, rhythmOf, schedulesOf, sideOf, WORKDAY } from './rhythmsTestData.js';
const at = (value) => new Date(value);
const events = (sleep) => sleep.events.map(event => `${event.kind} ${event.at.toISOString()}`);
// Every sleep starts before it ends and wakes inside itself.
const checked = (sleeps) => {
    for (const sleep of sleeps) {
        assert.ok(sleep.start < sleep.end, `${sleep.date} starts before it ends`);
        assert.ok(sleep.start <= sleep.wake && sleep.wake <= sleep.end, `${sleep.date} wakes inside the sleep`);
    }
    return sleeps;
};
const left = (db, timeZone, from, to) => checked(resolveSleeps({ db, side: 'left', timeZone, from: at(from), to: at(to) }));
const legacyLeft = (schedules, from, to, timeZone = 'UTC') => checked(resolveLegacySleeps({ schedules, side: 'left', timeZone, from: at(from), to: at(to) }));
describe('resolveSleeps', () => {
    const workdayDb = dbOf(sideOf([rhythmOf('workday', WORKDAY)], { monday: 'workday' }));
    it('resolves a night into power, temperature and alarm events in order', () => {
        const sleeps = left(workdayDb, 'UTC', '2026-10-05T00:00:00Z', '2026-10-07T00:00:00Z');
        assert.equal(sleeps.length, 1);
        const [sleep] = sleeps;
        assert.equal(sleep.date, '2026-10-05');
        assert.equal(sleep.rhythmId, 'workday');
        assert.equal(sleep.mode, 'manual');
        assert.equal(sleep.smart, undefined);
        assert.equal(sleep.start.toISOString(), '2026-10-05T22:00:00.000Z');
        assert.equal(sleep.end.toISOString(), '2026-10-06T07:00:00.000Z');
        assert.deepEqual(events(sleep), [
            'power-on 2026-10-05T22:00:00.000Z',
            'temperature 2026-10-05T23:00:00.000Z',
            'temperature 2026-10-06T03:00:00.000Z',
            'alarm 2026-10-06T06:30:00.000Z',
            'power-off 2026-10-06T07:00:00.000Z',
        ]);
        assert.deepEqual(sleep.events[0], { kind: 'power-on', at: at('2026-10-05T22:00:00Z'), temperatureF: 82 });
        assert.deepEqual(sleep.events[3], { kind: 'alarm', at: at('2026-10-06T06:30:00Z'), alarm: alarmAt('06:30'), index: 0 });
        assert.equal(sleep.wake.toISOString(), '2026-10-06T06:30:00.000Z');
    });
    it('resolves the wake time on its own, whatever the alarms, and keeps it inside the sleep', () => {
        const quiet = rhythmOf('quiet', nightOf({ on: '22:00', off: '07:00' }), { wake: '06:45' });
        const late = rhythmOf('late', WORKDAY, { wake: '09:00' });
        const db = dbOf(sideOf([quiet, late], { monday: 'quiet', tuesday: 'late' }));
        const sleeps = left(db, 'UTC', '2026-10-05T00:00:00Z', '2026-10-08T00:00:00Z');
        assert.deepEqual(sleeps.map(sleep => sleep.wake.toISOString()), ['2026-10-06T06:45:00.000Z', '2026-10-07T07:00:00.000Z']);
        assert.equal(applyAlarmsEnabled(sleeps, false)[0].wake.toISOString(), '2026-10-06T06:45:00.000Z');
    });
    it('wakes at the end of a full day night that wakes at its turn off', () => {
        const allday = nightOf({ on: '20:00', off: '20:00' });
        const db = dbOf(sideOf([rhythmOf('allday', allday)], { monday: 'allday' }));
        const [sleep] = left(db, 'UTC', '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z');
        assert.equal(sleep.wake.toISOString(), '2026-10-06T20:00:00.000Z');
        const [legacy] = legacyLeft(schedulesOf({ monday: allday }), '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z');
        assert.equal(legacy.wake.toISOString(), '2026-10-06T20:00:00.000Z');
    });
    it('keeps an off time after the on time on the same day', () => {
        const db = dbOf(sideOf([rhythmOf('nap', nightOf({ on: '13:00', off: '15:00' }))], { monday: 'nap' }));
        const [sleep] = left(db, 'UTC', '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z');
        assert.equal(sleep.start.toISOString(), '2026-10-05T13:00:00.000Z');
        assert.equal(sleep.end.toISOString(), '2026-10-05T15:00:00.000Z');
    });
    it('treats an off time equal to the on time as a full day', () => {
        const db = dbOf(sideOf([rhythmOf('allday', nightOf({ on: '20:00', off: '20:00' }))], { monday: 'allday' }));
        const [sleep] = left(db, 'UTC', '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z');
        assert.equal(sleep.start.toISOString(), '2026-10-05T20:00:00.000Z');
        assert.equal(sleep.end.toISOString(), '2026-10-06T20:00:00.000Z');
    });
    it('orders power on before a temperature and an alarm before power off at the same instant', () => {
        const night = nightOf({ on: '22:00', off: '07:00', temperatures: { '22:00': 70 }, alarms: [alarmAt('07:00')] });
        const db = dbOf(sideOf([rhythmOf('edge', night)], { monday: 'edge' }));
        const [sleep] = left(db, 'UTC', '2026-10-05T00:00:00Z', '2026-10-07T00:00:00Z');
        assert.deepEqual(sleep.events.map(event => event.kind), ['power-on', 'temperature', 'alarm', 'power-off']);
    });
    it('plans no sleep for a disabled night, an empty day or a missing rhythm', () => {
        const off = nightOf({ on: '22:00', off: '07:00', enabled: false });
        const db = dbOf(sideOf([rhythmOf('off', off)], { monday: 'off', wednesday: 'gone' }));
        assert.deepEqual(left(db, 'UTC', '2026-10-04T00:00:00Z', '2026-10-11T00:00:00Z'), []);
    });
    it('treats a rhythm id that only exists on Object as missing', () => {
        const db = dbOf(sideOf([], { monday: 'constructor' }, [{ date: '2026-10-07', rhythmId: 'toString' }]));
        assert.deepEqual(left(db, 'UTC', '2026-10-04T00:00:00Z', '2026-10-11T00:00:00Z'), []);
    });
    it('lets a date change replace the weekly plan, including with no sleep', () => {
        const nap = rhythmOf('nap', nightOf({ on: '13:00', off: '15:00' }));
        const db = dbOf(sideOf([rhythmOf('workday', WORKDAY), nap], { monday: 'workday' }, [
            { date: '2026-10-05', rhythmId: null },
            { date: '2026-10-12', rhythmId: 'nap' },
        ]));
        const sleeps = left(db, 'UTC', '2026-10-04T00:00:00Z', '2026-10-20T00:00:00Z');
        assert.deepEqual(sleeps.map(sleep => [sleep.date, sleep.rhythmId]), [['2026-10-12', 'nap'], ['2026-10-19', 'workday']]);
    });
    it('returns no sleeps for an invalid window instead of looping', () => {
        assert.deepEqual(resolveSleeps({ db: workdayDb, side: 'left', timeZone: 'UTC', from: at('2026-10-05T00:00:00Z'), to: at('x') }), []);
        assert.deepEqual(resolveSleeps({ db: workdayDb, side: 'left', timeZone: 'UTC', from: at('x'), to: at('2026-10-07T00:00:00Z') }), []);
    });
    it('refuses a window longer than the cap', () => {
        const from = at('2026-10-04T00:00:00Z');
        const longest = new Date(from.getTime() + MAX_RESOLVE_WINDOW_MS);
        assert.equal(MAX_RESOLVE_WINDOW_MS, 70 * 24 * 60 * 60 * 1000);
        assert.equal(resolveSleeps({ db: workdayDb, side: 'left', timeZone: 'UTC', from, to: longest }).length, 10);
        const tooLong = { db: workdayDb, side: 'left', timeZone: 'UTC', from, to: new Date(longest.getTime() + 1) };
        assert.throws(() => resolveSleeps(tooLong), RangeError);
        assert.throws(() => findOverlaps(tooLong), RangeError);
        const schedules = schedulesOf({ monday: WORKDAY });
        assert.throws(() => resolveLegacySleeps({ ...tooLong, schedules }), RangeError);
    });
    it('includes sleeps that touch the window at either edge', () => {
        const edges = (from, to) => left(workdayDb, 'UTC', from, to).map(sleep => sleep.date);
        assert.deepEqual(edges('2026-10-06T06:00:00Z', '2026-10-06T12:00:00Z'), ['2026-10-05']);
        assert.deepEqual(edges('2026-10-06T07:00:00Z', '2026-10-06T12:00:00Z'), ['2026-10-05']);
        assert.deepEqual(edges('2026-10-06T07:01:00Z', '2026-10-06T12:00:00Z'), []);
        assert.deepEqual(edges('2026-10-05T12:00:00Z', '2026-10-05T22:00:00Z'), ['2026-10-05']);
        assert.deepEqual(edges('2026-10-05T12:00:00Z', '2026-10-05T21:59:00Z'), []);
    });
    it('resolves only enabled alarms and numbers them in that order', () => {
        const night = nightOf({ on: '22:00', off: '07:00', alarms: [
                alarmAt('06:00'), alarmAt('06:10', { enabled: false }), alarmAt('06:20', { vibrationIntensity: 40 }),
            ] });
        const db = dbOf(sideOf([rhythmOf('two', night)], { monday: 'two' }));
        const [sleep] = left(db, 'UTC', '2026-10-05T00:00:00Z', '2026-10-07T00:00:00Z');
        const alarms = sleep.events.filter(event => event.kind === 'alarm');
        assert.deepEqual(alarms.map(event => event.kind === 'alarm' && [event.at.toISOString(), event.index, event.alarm.vibrationIntensity]), [
            ['2026-10-06T06:00:00.000Z', 0, 80],
            ['2026-10-06T06:20:00.000Z', 1, 40],
        ]);
    });
    it('drops alarm events when the side has alarms turned off', () => {
        const sleeps = left(workdayDb, 'UTC', '2026-10-05T00:00:00Z', '2026-10-07T00:00:00Z');
        assert.equal(applyAlarmsEnabled(sleeps, true), sleeps);
        const quiet = applyAlarmsEnabled(sleeps, false);
        assert.deepEqual(quiet[0].events.map(event => event.kind), ['power-on', 'temperature', 'temperature', 'power-off']);
        assert.equal(sleeps[0].events.length, 5, 'the input is not changed');
    });
    it('resolves Smart Schedule rhythms through the curve, from the pre-warm, and keeps their alarms', () => {
        const smart = { ...DEFAULT_SMART, baseLevel: -2 };
        const db = dbOf(sideOf([rhythmOf('smart', WORKDAY, { temperatureMode: 'smart', smart })], { monday: 'smart' }));
        const [sleep] = left(db, 'UTC', '2026-10-05T00:00:00Z', '2026-10-07T00:00:00Z');
        const [manual] = left(workdayDb, 'UTC', '2026-10-05T00:00:00Z', '2026-10-07T00:00:00Z');
        assert.equal(sleep.mode, 'smart');
        assert.deepEqual(sleep.smart, smart);
        assert.equal(sleep.start.toISOString(), '2026-10-05T21:30:00.000Z');
        assert.equal(sleep.smartCurve?.bedtime.toISOString(), manual.start.toISOString());
        assert.deepEqual(sleep.events.filter(event => event.kind === 'alarm'), manual.events.filter(event => event.kind === 'alarm'));
    });
});
describe('resolveSleeps across daylight saving changes', () => {
    const dst = { on: '23:00', off: '07:00' };
    it('moves a time inside the spring gap forward (America/Los_Angeles, 2026-03-08)', () => {
        const night = nightOf({ ...dst, temperatures: { '01:30': 72, '02:30': 70 }, alarms: [alarmAt('02:30')] });
        const db = dbOf(sideOf([rhythmOf('spring', night)], { saturday: 'spring' }));
        const [sleep] = left(db, 'America/Los_Angeles', '2026-03-07T12:00:00Z', '2026-03-09T00:00:00Z');
        assert.deepEqual(events(sleep), [
            'power-on 2026-03-08T07:00:00.000Z',
            'temperature 2026-03-08T09:30:00.000Z',
            'temperature 2026-03-08T10:30:00.000Z',
            'alarm 2026-03-08T10:30:00.000Z',
            'power-off 2026-03-08T14:00:00.000Z',
        ]);
    });
    it('starts a sleep whose power on falls in the gap at the end of the gap', () => {
        const db = dbOf(sideOf([rhythmOf('gap', nightOf({ on: '02:30', off: '06:00' }))], { sunday: 'gap' }));
        const [sleep] = left(db, 'America/Los_Angeles', '2026-03-08T00:00:00Z', '2026-03-09T00:00:00Z');
        assert.equal(sleep.start.toISOString(), '2026-03-08T10:30:00.000Z');
        assert.equal(sleep.end.toISOString(), '2026-03-08T13:00:00.000Z');
    });
    it('plans no sleep when the gap moves power on to or past power off', () => {
        const short = rhythmOf('short', nightOf({ on: '02:30', off: '03:15', temperatures: { '03:05': 70 } }));
        const sleepsFor = (db) => left(db, 'America/Los_Angeles', '2026-03-07T00:00:00Z', '2026-03-16T00:00:00Z');
        const sleeps = sleepsFor(dbOf(sideOf([short], { sunday: 'short' })));
        assert.deepEqual(sleeps.map(sleep => [sleep.date, sleep.start.toISOString(), sleep.end.toISOString()]), [
            ['2026-03-15', '2026-03-15T09:30:00.000Z', '2026-03-15T10:15:00.000Z'],
        ]);
        const empty = rhythmOf('empty', nightOf({ on: '02:00', off: '03:00' }));
        const changed = dbOf(sideOf([short, empty], { sunday: 'short' }, [{ date: '2026-03-08', rhythmId: 'empty' }]));
        assert.deepEqual(sleepsFor(changed).map(sleep => sleep.date), ['2026-03-15']);
        const london = schedulesOf({ sunday: nightOf({ on: '01:30', off: '02:10' }) });
        assert.deepEqual(legacyLeft(london, '2026-03-28T00:00:00Z', '2026-03-30T00:00:00Z', 'Europe/London'), []);
    });
    it('takes the first of a repeated time (America/Los_Angeles, 2026-11-01)', () => {
        const night = nightOf({ on: '22:00', off: '07:00', temperatures: { '01:30': 70 }, alarms: [alarmAt('06:30')] });
        const db = dbOf(sideOf([rhythmOf('fall', night)], { saturday: 'fall' }));
        const [sleep] = left(db, 'America/Los_Angeles', '2026-10-31T12:00:00Z', '2026-11-02T00:00:00Z');
        assert.deepEqual(events(sleep), [
            'power-on 2026-11-01T05:00:00.000Z',
            'temperature 2026-11-01T08:30:00.000Z',
            'alarm 2026-11-01T14:30:00.000Z',
            'power-off 2026-11-01T15:00:00.000Z',
        ]);
    });
    it('handles both Europe/London changes', () => {
        const night = nightOf({ ...dst, temperatures: { '01:30': 70 } });
        const db = dbOf(sideOf([rhythmOf('london', night)], { saturday: 'london' }));
        const [spring] = left(db, 'Europe/London', '2026-03-28T12:00:00Z', '2026-03-29T12:00:00Z');
        assert.deepEqual(events(spring), [
            'power-on 2026-03-28T23:00:00.000Z',
            'temperature 2026-03-29T01:30:00.000Z',
            'power-off 2026-03-29T06:00:00.000Z',
        ]);
        const [fall] = left(db, 'Europe/London', '2026-10-24T12:00:00Z', '2026-10-25T12:00:00Z');
        assert.deepEqual(events(fall), [
            'power-on 2026-10-24T22:00:00.000Z',
            'temperature 2026-10-25T00:30:00.000Z',
            'power-off 2026-10-25T07:00:00.000Z',
        ]);
    });
});
describe('resolveLegacySleeps', () => {
    it('reads the weekly schedule, including the single alarm form', () => {
        const legacyAlarm = { ...WORKDAY, alarm: alarmAt('06:30'), alarms: [] };
        const schedules = schedulesOf({ monday: legacyAlarm });
        const sleeps = legacyLeft(schedules, '2026-10-04T00:00:00Z', '2026-10-11T00:00:00Z');
        assert.equal(sleeps.length, 1);
        assert.equal(sleeps[0].rhythmId, null);
        assert.equal(sleeps[0].mode, 'manual');
        assert.deepEqual(sleeps[0].night.alarms, [alarmAt('06:30')]);
        assert.ok(sleeps[0].events.some(event => event.kind === 'alarm' && event.at.toISOString() === '2026-10-06T06:30:00.000Z'));
    });
    it('wakes at the earliest enabled alarm inside the night, else at the turn off', () => {
        const noAlarm = nightOf({ on: '22:00', off: '07:00', alarms: [alarmAt('06:30', { enabled: false })] });
        const schedules = schedulesOf({ monday: WORKDAY, tuesday: noAlarm });
        const sleeps = legacyLeft(schedules, '2026-10-05T00:00:00Z', '2026-10-08T00:00:00Z');
        assert.deepEqual(sleeps.map(sleep => sleep.wake.toISOString()), ['2026-10-06T06:30:00.000Z', '2026-10-07T07:00:00.000Z']);
    });
    it('ignores unknown keys stored beside a day', () => {
        const schedules = schedulesOf({ monday: { ...WORKDAY, futureDay: { kept: true } } });
        const [sleep] = legacyLeft(schedules, '2026-10-05T00:00:00Z', '2026-10-07T00:00:00Z');
        assert.equal('futureDay' in sleep.night, false);
    });
});
describe('findOverlaps', () => {
    const window = { side: 'left', timeZone: 'UTC', from: at('2026-10-04T00:00:00Z'), to: at('2026-10-12T00:00:00Z') };
    it('names both dates when a sleep runs into the next one', () => {
        const allday = rhythmOf('allday', nightOf({ on: '23:30', off: '23:30' }));
        const db = dbOf(sideOf([rhythmOf('workday', WORKDAY), allday], { monday: 'workday', tuesday: 'workday' }, [
            { date: '2026-10-05', rhythmId: 'allday' },
        ]));
        assert.deepEqual(findOverlaps({ db, ...window }), [{ first: '2026-10-05', second: '2026-10-06' }]);
    });
    it('allows a sleep to end exactly when the next one starts', () => {
        const allday = rhythmOf('allday', nightOf({ on: '22:00', off: '22:00' }));
        const db = dbOf(sideOf([rhythmOf('workday', WORKDAY), allday], { monday: 'allday', tuesday: 'workday' }));
        assert.deepEqual(findOverlaps({ db, ...window }), []);
    });
});
//# sourceMappingURL=resolve.test.js.map