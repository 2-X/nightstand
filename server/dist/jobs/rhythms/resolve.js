import moment from 'moment-timezone';
import { wakeFromNight } from '../../db/rhythmWake.js';
import { SCHEDULE_DAYS } from '../../db/scheduleKeys.js';
import { compareTimes, isValidTime, scheduleWrapsToNextDay } from '../utils.js';
import { normalizeNight } from './night.js';
import { applySmartCurve } from './smartSleep.js';
// Longer than any caller needs, so a mistaken window cannot resolve years of sleeps.
export const MAX_RESOLVE_WINDOW_MS = 70 * 24 * 60 * 60 * 1000;
const KIND_ORDER = { 'power-on': 0, temperature: 1, alarm: 2, 'power-off': 3 };
const DATE_FORMAT = 'YYYY-MM-DD';
const addDays = (date, days) => moment.utc(date, DATE_FORMAT, true).add(days, 'day').format(DATE_FORMAT);
const weekdayOf = (date) => SCHEDULE_DAYS[moment.utc(date, DATE_FORMAT, true).day()];
// A time that does not exist on this date (spring forward) moves forward by
// the gap; a time that happens twice (fall back) takes the first occurrence.
function wallClock(date, time, timeZone) {
    return moment.tz(`${date} ${time}`, `${DATE_FORMAT} HH:mm`, true, timeZone).toDate();
}
// Times at or after power on belong to the start date, earlier ones to the next.
const dateForTime = (date, time, powerOn) => (compareTimes(time, powerOn) >= 0 ? date : addDays(date, 1));
function resolveNight(side, date, source, timeZone) {
    const night = normalizeNight(source.night);
    const { power } = night;
    if (!power.enabled || !isValidTime(power.on) || !isValidTime(power.off))
        return null;
    const start = wallClock(date, power.on, timeZone);
    const end = wallClock(scheduleWrapsToNextDay(power) ? addDays(date, 1) : date, power.off, timeZone);
    // A short night starting in a spring-forward gap can lose its whole length.
    // The legacy engine skips that power on and leaves the side off.
    if (end <= start)
        return null;
    const events = [{ kind: 'power-on', at: start, temperatureF: power.onTemperature }];
    for (const [time, temperatureF] of Object.entries(night.temperatures)) {
        if (!isValidTime(time))
            continue;
        events.push({ kind: 'temperature', at: wallClock(dateForTime(date, time, power.on), time, timeZone), temperatureF });
    }
    night.alarms.filter(alarm => alarm.enabled).forEach((alarm, index) => {
        if (!isValidTime(alarm.time))
            return;
        events.push({ kind: 'alarm', at: wallClock(dateForTime(date, alarm.time, power.on), alarm.time, timeZone), alarm, index });
    });
    events.push({ kind: 'power-off', at: end });
    events.sort((a, b) => a.at.getTime() - b.at.getTime() || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    const wakeTime = source.wake !== undefined && isValidTime(source.wake) ? source.wake : wakeFromNight(night);
    // Waking at the turn off means the end, even when off equals on.
    const wakeAt = wakeTime === power.off ? end.getTime() : wallClock(dateForTime(date, wakeTime, power.on), wakeTime, timeZone).getTime();
    const wake = new Date(Math.min(Math.max(wakeAt, start.getTime()), end.getTime()));
    const sleep = { side, date, rhythmId: source.rhythmId, start, end, wake, night, mode: source.mode, events };
    if (source.mode === 'smart' && source.smart)
        sleep.smart = { ...source.smart };
    return sleep;
}
// A sleep starting the day before `from` can still be running at `from`.
function resolveWindow(window, sourceFor) {
    const { side, timeZone, from, to } = window;
    // An invalid date formats as 'Invalid date', which would never end the loop.
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
        return [];
    if (to.getTime() - from.getTime() > MAX_RESOLVE_WINDOW_MS)
        throw new RangeError('The window to resolve is longer than 70 days');
    const last = moment.tz(to, timeZone).format(DATE_FORMAT);
    const sleeps = [];
    for (let date = addDays(moment.tz(from, timeZone).format(DATE_FORMAT), -1); date <= last; date = addDays(date, 1)) {
        const source = sourceFor(date);
        const night = source ? resolveNight(side, date, source, timeZone) : null;
        // The pre-warm moves a Smart Schedule start earlier, so the curve goes on before the window check.
        const sleep = night && applySmartCurve(night, timeZone, window.coolStartFor?.(side, date));
        if (sleep && sleep.start <= to && sleep.end >= from)
            sleeps.push(sleep);
    }
    return sleeps;
}
export function resolveSleeps(args) {
    const plan = args.db[args.side];
    return resolveWindow(args, date => {
        const change = plan.changes.find(entry => entry.date === date);
        const rhythmId = change ? change.rhythmId : plan.week[weekdayOf(date)];
        const rhythm = rhythmId && Object.hasOwn(plan.rhythms, rhythmId) ? plan.rhythms[rhythmId] : undefined;
        if (!rhythm)
            return null;
        return { rhythmId: rhythm.id, night: rhythm.night, wake: rhythm.wake, mode: rhythm.temperatureMode, smart: rhythm.smart };
    });
}
export function resolveLegacySleeps(args) {
    return resolveWindow(args, date => ({ rhythmId: null, night: args.schedules[args.side][weekdayOf(date)], mode: 'manual' }));
}
export function findOverlaps(args) {
    const sleeps = resolveSleeps(args);
    const overlaps = [];
    sleeps.forEach((sleep, index) => {
        for (const next of sleeps.slice(index + 1)) {
            if (next.start >= sleep.end)
                break;
            overlaps.push({ first: sleep.date, second: next.date });
        }
    });
    return overlaps;
}
// alarmsEnabled is a side setting, not schedule data, so callers apply it.
export function applyAlarmsEnabled(sleeps, alarmsEnabled) {
    if (alarmsEnabled)
        return sleeps;
    return sleeps.map(sleep => ({ ...sleep, events: sleep.events.filter(event => event.kind !== 'alarm') }));
}
//# sourceMappingURL=resolve.js.map