import assert from 'node:assert/strict';
import { after, describe, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import moment from 'moment-timezone';
// The legacy schedulers import the lowdb loaders, which read DATA_FOLDER at
// import time, so it is set before the dynamic imports below.
const folder = mkdtempSync(path.join(tmpdir(), 'rhythms-equivalence-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
after(() => rmSync(folder, { recursive: true, force: true }));
// Real RecurrenceRule, fake scheduleJob: every job the legacy engine creates is
// captured, and its fire instants come from the rule's own nextInvocationDate.
const realSchedule = (await import('node-schedule')).default;
const captured = [];
mock.module('node-schedule', {
    defaultExport: {
        RecurrenceRule: realSchedule.RecurrenceRule,
        scheduleJob: (name, rule) => { captured.push({ name, rule }); return null; },
        scheduledJobs: {},
        cancelJob: () => true,
        gracefulShutdown: async () => { },
    },
});
const { schedulePowerOff, schedulePowerOn } = await import('../powerScheduler.js');
const { scheduleTemperatures } = await import('../temperatureScheduler.js');
const { scheduleAlarm } = await import('../alarmScheduler.js');
const { dailyAlarmSchedules } = await import('../../db/scheduleAlarms.js');
const { SCHEDULE_DAYS, SCHEDULE_SIDES } = await import('../../db/scheduleKeys.js');
const { compareTimes, scheduleWrapsToNextDay } = await import('../utils.js');
const { RhythmsDBSchema } = await import('../../db/rhythmsSchema.js');
const { applyAlarmsEnabled, resolveLegacySleeps, resolveSleeps } = await import('./resolve.js');
const { convertLegacy } = await import('./convert.js');
const { legacyFingerprint } = await import('./fingerprint.js');
// Small seeded generator (mulberry32) so every case can be replayed by seed.
function random(seed) {
    let state = seed >>> 0;
    const next = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (min, max) => min + Math.floor(next() * (max - min + 1));
    const pick = (items) => items[int(0, items.length - 1)];
    return { next, int, pick };
}
const pad = (value) => String(value).padStart(2, '0');
// Times near midnight and the daylight saving changes come up often.
const EDGE_TIMES = ['00:00', '00:30', '00:59', '01:00', '01:30', '01:59', '02:00', '02:30', '03:00', '03:30', '23:59'];
const anyTime = r => (r.next() < 0.4 ? r.pick(EDGE_TIMES) : `${pad(r.int(0, 23))}:${pad(r.pick([0, 15, 30, 45, r.int(0, 59)]))}`);
// node-schedule takes about 2 ms per next invocation, so the engine comparison
// draws from a fixed pool and caches each rule's instants.
const POOL_TIMES = [...EDGE_TIMES, '06:00', '06:30', '07:00', '08:15', '09:00', '12:00', '13:00', '15:45', '18:00', '20:00',
    '21:30', '22:00', '22:45', '23:00'];
const poolTime = r => r.pick(POOL_TIMES);
function randomAlarm(r, time, enabled = r.next() < 0.8) {
    return {
        time: time(r), enabled, vibrationIntensity: r.int(1, 100), vibrationPattern: r.pick(['double', 'rise']),
        duration: r.int(1, 300), alarmTemperature: r.int(55, 110),
    };
}
function randomNight(r, time) {
    const on = time(r);
    const temperatures = {};
    for (let n = r.int(0, 4); n > 0; n--)
        temperatures[time(r)] = r.int(55, 110);
    const shape = r.int(0, 2);
    const alarms = shape === 2 ? Array.from({ length: r.int(1, 3) }, () => randomAlarm(r, time)) : [];
    const alarm = shape === 0 ? randomAlarm(r, time, true) : alarms[0] ?? randomAlarm(r, time, false);
    return {
        temperatures,
        alarm,
        alarms,
        power: { on, off: r.next() < 0.1 ? on : time(r), onTemperature: r.int(55, 110), enabled: r.next() < 0.8 },
    };
}
function randomSchedules(r, time) {
    const side = () => {
        const nights = SCHEDULE_DAYS.map(() => randomNight(r, time));
        // Repeat some nights so conversion has groups to share.
        if (r.next() < 0.5)
            for (const index of [1, 2, 3, 4])
                nights[index] = structuredClone(nights[r.pick([0, 1])]);
        return Object.fromEntries(SCHEDULE_DAYS.map((day, index) => [day, nights[index]]));
    };
    return { left: side(), right: side() };
}
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Each window starts a week before a 2026 daylight saving change, or has none.
const ZONE_WINDOWS = [
    ['America/Los_Angeles', '2026-03-01T00:00:00Z'], ['America/Los_Angeles', '2026-10-25T00:00:00Z'],
    ['Europe/London', '2026-03-22T00:00:00Z'], ['Europe/London', '2026-10-18T00:00:00Z'],
    ['Australia/Sydney', '2026-03-29T00:00:00Z'], ['Australia/Sydney', '2026-09-27T00:00:00Z'],
    ['UTC', '2026-06-01T00:00:00Z'],
];
const describeEvent = (side, event) => {
    const base = `${side} ${event.kind} ${event.at.toISOString()}`;
    if (event.kind === 'power-on' || event.kind === 'temperature')
        return `${base} ${event.temperatureF}F`;
    if (event.kind === 'alarm') {
        const { time, enabled, vibrationIntensity, vibrationPattern, duration, alarmTemperature } = event.alarm;
        return `${base} #${event.index} ${time} ${enabled} ${vibrationIntensity} ${vibrationPattern} ${duration}s ${alarmTemperature}F`;
    }
    return base;
};
const instantsCache = new Map();
// Counted per use, not per cache fill, so each test can see what its own cases reach.
const normalized = { repeats: 0, gaps: 0, lostNights: 0 };
function computeInstants(rule, timeZone, from, to) {
    const fires = [];
    let repeats = 0;
    let gaps = 0;
    const wall = (value) => moment.tz(value, timeZone).format('YYYY-MM-DD HH:mm');
    for (let base = new Date(from.getTime() - 1000);;) {
        const next = rule.nextInvocationDate(base);
        if (!next || next > to)
            break;
        // node-schedule fires a repeated wall-clock time twice at a fall-back
        // change. The repeat re-applies the same state (alarms dedupe it by
        // occurrence), so it counts once, at the first instant.
        if (fires.length && wall(fires[fires.length - 1]) === wall(next))
            repeats++;
        else
            fires.push(next);
        base = next;
    }
    // node-schedule skips a wall-clock time that does not exist (spring
    // forward). The resolver moves it forward instead; add that instant here.
    const hhmm = `${pad(Number(rule.hour))}:${pad(Number(rule.minute))}`;
    for (let day = moment.tz(from, timeZone).startOf('day').subtract(1, 'day'); day.isSameOrBefore(to); day.add(1, 'day')) {
        if (day.day() !== Number(rule.dayOfWeek))
            continue;
        const moved = moment.tz(`${day.format('YYYY-MM-DD')} ${hhmm}`, 'YYYY-MM-DD HH:mm', timeZone);
        if (moved.format('HH:mm') !== hhmm && moved.toDate() >= from && moved.toDate() <= to) {
            gaps++;
            fires.push(moved.toDate());
        }
    }
    return { fires, repeats, gaps };
}
function legacyInstants(rule, timeZone, from, to) {
    const key = [timeZone, rule.dayOfWeek, rule.hour, rule.minute, from.toISOString(), to.toISOString()].join('|');
    const instants = instantsCache.get(key) ?? computeInstants(rule, timeZone, from, to);
    instantsCache.set(key, instants);
    normalized.repeats += instants.repeats;
    normalized.gaps += instants.gaps;
    return instants.fires;
}
// The night a legacy fire belongs to, by the resolver's day rules.
function nightDateOf(kind, time, power, at, timeZone) {
    const earlier = kind === 'power-off' ? scheduleWrapsToNextDay(power) : compareTimes(time, power.on) < 0;
    return moment.tz(at, timeZone).subtract(earlier ? 1 : 0, 'day').format('YYYY-MM-DD');
}
// A short night whose power on the spring gap moves to or past its power off
// is no sleep in the resolver; the legacy engine leaves the side off. This
// restates the resolver's rule rather than observing the engine. It assumes
// the side is off: if the previous night still runs through these times, the
// engine would apply them to that night and switch it off, and this drops them.
function lostNight(power, date, timeZone) {
    const at = (day, time) => moment.tz(`${day} ${time}`, 'YYYY-MM-DD HH:mm', timeZone).valueOf();
    const offDate = scheduleWrapsToNextDay(power) ? moment.utc(date).add(1, 'day').format('YYYY-MM-DD') : date;
    return at(offDate, power.off) <= at(date, power.on);
}
// What the legacy engine would do between from and to, in the resolver's terms.
function legacyEngineEvents(schedules, settings, from, to) {
    captured.length = 0;
    for (const side of SCHEDULE_SIDES) {
        for (const day of SCHEDULE_DAYS) {
            const daily = schedules[side][day];
            schedulePowerOn(settings, side, day, daily.power);
            schedulePowerOff(settings, side, day, daily.power);
            scheduleTemperatures(settings, side, day, daily.temperatures, daily.power);
            scheduleAlarm(settings, side, day, daily);
        }
    }
    const out = [];
    for (const { name, rule } of captured) {
        const match = /^(left|right)-([a-z]+)-(\d\d:\d\d)-(?:(\d+)-)?(power-on|power-off|temperature-adjustment|alarm)$/.exec(name);
        assert.ok(match, `unexpected legacy job ${name}`);
        const [, side, day, time, number, kind] = match;
        const daily = schedules[side][day];
        for (const at of legacyInstants(rule, settings.timeZone, from, to)) {
            if (lostNight(daily.power, nightDateOf(kind, time, daily.power, at, settings.timeZone), settings.timeZone)) {
                normalized.lostNights++;
                continue;
            }
            if (kind === 'power-on')
                out.push(describeEvent(side, { kind: 'power-on', at, temperatureF: daily.power.onTemperature }));
            if (kind === 'power-off')
                out.push(describeEvent(side, { kind: 'power-off', at }));
            if (kind === 'temperature-adjustment')
                out.push(describeEvent(side, { kind: 'temperature', at, temperatureF: Number(number) }));
            if (kind === 'alarm') {
                const alarm = dailyAlarmSchedules(daily).filter(entry => entry.enabled)[Number(number)];
                out.push(describeEvent(side, { kind: 'alarm', at, alarm, index: Number(number) }));
            }
        }
    }
    return out.sort();
}
// A temperature or alarm stored outside its power window fires after that
// night has ended, so nights from two days earlier are resolved too.
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
function resolverEvents(schedules, settings, from, to) {
    return SCHEDULE_SIDES.flatMap(side => {
        const sleeps = resolveLegacySleeps({ schedules, side, timeZone: settings.timeZone, from: new Date(from.getTime() - TWO_DAYS_MS), to });
        return applyAlarmsEnabled(sleeps, settings[side].alarmsEnabled).flatMap(sleep => sleep.events
            .filter(event => event.at >= from && event.at <= to)
            .map(event => describeEvent(side, event)));
    }).sort();
}
const settingsFor = (timeZone, alarmsEnabled = { left: true, right: true }) => ({
    timeZone,
    left: { awayMode: false, alarmsEnabled: alarmsEnabled.left },
    right: { awayMode: false, alarmsEnabled: alarmsEnabled.right },
});
function caseFor(seed, time, weeks, windows = ZONE_WINDOWS) {
    const r = random(seed);
    const schedules = randomSchedules(r, time);
    const [timeZone, start] = r.pick(windows);
    const from = new Date(start);
    return { schedules, timeZone, from, to: new Date(from.getTime() + weeks * WEEK_MS) };
}
describe('the legacy engine against resolveLegacySleeps', () => {
    it('pins how node-schedule treats the daylight saving changes this gate normalizes', () => {
        const fires = (hour, minute, timeZone, from) => {
            const rule = new realSchedule.RecurrenceRule();
            Object.assign(rule, { dayOfWeek: 0, hour, minute, tz: timeZone });
            const out = [];
            for (let base = new Date(Date.parse(from) - 1000); out.length < 3;) {
                const next = rule.nextInvocationDate(base);
                out.push(next.toISOString());
                base = next;
            }
            return out;
        };
        // Spring forward: 02:30 does not exist on 2026-03-08, and the job skips that Sunday.
        assert.deepEqual(fires(2, 30, 'America/Los_Angeles', '2026-03-01T00:00:00Z'), ['2026-03-01T10:30:00.000Z', '2026-03-15T09:30:00.000Z', '2026-03-22T09:30:00.000Z']);
        // Fall back: 01:30 happens twice on 2026-11-01, and the job fires at both.
        assert.deepEqual(fires(1, 30, 'America/Los_Angeles', '2026-10-31T00:00:00Z'), ['2026-11-01T08:30:00.000Z', '2026-11-01T09:30:00.000Z', '2026-11-08T09:30:00.000Z']);
    });
    it('fires exactly the resolved instants for 150 random weekly schedules over 3 weeks', () => {
        const before = { ...normalized };
        for (let seed = 1; seed <= 150; seed++) {
            const { schedules, timeZone, from, to } = caseFor(seed, poolTime, 3);
            const settings = settingsFor(timeZone);
            assert.deepEqual(resolverEvents(schedules, settings, from, to), legacyEngineEvents(schedules, settings, from, to), `seed ${seed} (${timeZone}, from ${from.toISOString()})`);
        }
        assert.ok(normalized.repeats > before.repeats && normalized.gaps > before.gaps, 'the cases reach both daylight saving changes');
    });
    it('fires exactly the resolved instants for 60 schedules of edge times around the changes', () => {
        const before = { ...normalized };
        const edgeTime = r => r.pick(EDGE_TIMES);
        for (let seed = 2001; seed <= 2060; seed++) {
            const { schedules, timeZone, from, to } = caseFor(seed, edgeTime, 3, ZONE_WINDOWS.filter(([zone]) => zone !== 'UTC'));
            const settings = settingsFor(timeZone);
            assert.deepEqual(resolverEvents(schedules, settings, from, to), legacyEngineEvents(schedules, settings, from, to), `seed ${seed} (${timeZone}, from ${from.toISOString()})`);
        }
        assert.ok(normalized.repeats > before.repeats && normalized.gaps > before.gaps, 'the cases reach both daylight saving changes');
        assert.ok(normalized.lostNights > before.lostNights, 'the cases reach a night the spring gap swallows');
    });
    // Each night starts inside that zone's spring gap and ends at or before the moved start.
    const LOST_NIGHTS = [
        { zone: 'America/Los_Angeles', from: '2026-03-01T00:00:00Z', lost: '2026-03-08', night: ['02:30', '03:00', '03:10', '03:15'] },
        { zone: 'America/Los_Angeles', from: '2026-03-01T00:00:00Z', lost: '2026-03-08', night: ['02:00', '02:15', '02:40', '03:00'] },
        { zone: 'Europe/London', from: '2026-03-22T00:00:00Z', lost: '2026-03-29', night: ['01:30', '01:45', '01:50', '02:00'] },
        { zone: 'Australia/Sydney', from: '2026-09-27T00:00:00Z', lost: '2026-10-04', night: ['02:30', '02:45', '02:50', '03:00'] },
    ];
    it('plans no sleep for a night the spring gap swallows, as the engine leaves the side off', () => {
        for (const { zone, from: start, lost, night: [on, temperature, alarmTime, off] } of LOST_NIGHTS) {
            const r = random(1);
            const daily = {
                temperatures: { [temperature]: 70 },
                alarm: randomAlarm(r, () => alarmTime, true),
                alarms: [],
                power: { on, off, onTemperature: 75, enabled: true },
            };
            const side = Object.fromEntries(SCHEDULE_DAYS.map(day => [day, structuredClone(daily)]));
            const schedules = { left: side, right: structuredClone(side) };
            const from = new Date(start);
            const to = new Date(from.getTime() + 2 * WEEK_MS);
            const dates = resolveLegacySleeps({ schedules, side: 'left', timeZone: zone, from, to }).map(sleep => sleep.date);
            const around = [-1, 1].map(days => moment.utc(lost).add(days, 'day').format('YYYY-MM-DD'));
            assert.equal(dates.includes(lost), false, `${zone} ${lost}`);
            assert.ok(around.every(date => dates.includes(date)), `${zone} around ${lost}`);
            const before = normalized.lostNights;
            const settings = settingsFor(zone);
            assert.deepEqual(resolverEvents(schedules, settings, from, to), legacyEngineEvents(schedules, settings, from, to), zone);
            // Power on, temperature, alarm and power off, on each side.
            assert.equal(normalized.lostNights - before, 8, zone);
        }
    });
    it('agrees when a side has alarms turned off', () => {
        for (let seed = 1001; seed <= 1030; seed++) {
            const { schedules, timeZone, from, to } = caseFor(seed, poolTime, 3);
            const settings = settingsFor(timeZone, { left: false, right: true });
            const legacy = legacyEngineEvents(schedules, settings, from, to);
            assert.equal(legacy.some(event => event.startsWith('left alarm')), false, `seed ${seed}`);
            assert.deepEqual(resolverEvents(schedules, settings, from, to), legacy, `seed ${seed}`);
        }
    });
});
// The wake: the enabled alarm earliest by clock after power on (more than 0
// and at most the night's length, a full day when off equals on), at its
// resolved instant held inside the sleep; with none, or one at power off, the
// end. On a spring-forward night with times in the gap the held instant can be
// the moved power on, or the end although an alarm rang; that is accepted.
function expectedWake(sleep) {
    const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const { on, off } = sleep.night.power;
    const after = (time) => (minutes(time) - minutes(on) + 1440) % 1440;
    const length = off === on ? 1440 : after(off);
    const first = sleep.events
        .flatMap(event => (event.kind === 'alarm' && after(event.alarm.time) > 0 && after(event.alarm.time) <= length ? [event] : []))
        .sort((a, b) => after(a.alarm.time) - after(b.alarm.time))[0];
    if (!first || first.alarm.time === off)
        return sleep.end.getTime();
    return Math.min(Math.max(first.at.getTime(), sleep.start.getTime()), sleep.end.getTime());
}
describe('convertLegacy then resolveSleeps against resolveLegacySleeps', () => {
    it('produces the same sleeps, event for event, for 400 random weekly schedules over 8 weeks', () => {
        let alarmWakes = 0;
        for (let seed = 1; seed <= 400; seed++) {
            const { schedules, timeZone, from, to } = caseFor(seed, anyTime, 8);
            const converted = convertLegacy(schedules);
            const db = RhythmsDBSchema.parse({ version: 1, legacyFingerprint: legacyFingerprint(schedules), ...converted });
            for (const side of SCHEDULE_SIDES) {
                const legacy = resolveLegacySleeps({ schedules, side, timeZone, from, to });
                const rhythms = resolveSleeps({ db, side, timeZone, from, to });
                const withoutId = (sleeps) => sleeps.map(sleep => ({ ...sleep, rhythmId: null }));
                assert.deepEqual(withoutId(rhythms), withoutId(legacy), `seed ${seed} ${side} (${timeZone}, from ${from.toISOString()})`);
                // Both sides derive the wake the same way, so check it on its own terms.
                for (const sleep of legacy) {
                    if (expectedWake(sleep) !== sleep.end.getTime())
                        alarmWakes++;
                    assert.equal(sleep.wake.getTime(), expectedWake(sleep), `seed ${seed} ${side} wake on ${sleep.date}`);
                }
                assert.ok(rhythms.every(sleep => sleep.rhythmId && db[side].week[SCHEDULE_DAYS[moment.utc(sleep.date).day()]] === sleep.rhythmId), `seed ${seed} ${side} rhythm ids`);
            }
        }
        assert.ok(alarmWakes > 0, 'some sleeps wake at an alarm');
    });
});
//# sourceMappingURL=equivalence.test.js.map