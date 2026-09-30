import moment from 'moment-timezone';
import { AlarmSchedule, DailySchedule, DayOfWeek, Schedules, Side } from '../../db/schedulesSchema.js';
import { RhythmsDB, SmartSchedule } from '../../db/rhythmsSchema.js';
import { wakeFromNight } from '../../db/rhythmWake.js';
import { SCHEDULE_DAYS } from '../../db/scheduleKeys.js';
import { compareTimes, isValidTime, scheduleWrapsToNextDay } from '../utils.js';
import { normalizeNight } from './night.js';

export type RhythmEvent =
  | { kind: 'power-on'; at: Date; temperatureF: number }
  | { kind: 'temperature'; at: Date; temperatureF: number }
  | { kind: 'alarm'; at: Date; alarm: AlarmSchedule; index: number }
  | { kind: 'power-off'; at: Date };

export type ResolvedSleep = {
  side: Side;
  date: string;
  rhythmId: string | null;
  start: Date;
  end: Date;
  wake: Date;
  night: DailySchedule;
  mode: 'manual' | 'smart';
  smart?: SmartSchedule;
  events: RhythmEvent[];
};

type Window = { side: Side; timeZone: string; from: Date; to: Date };
type Overlap = { first: string; second: string };
// wake is left out for the weekly schedule, which takes it from the night.
type NightSource = { rhythmId: string | null; night: DailySchedule; wake?: string; mode: 'manual' | 'smart'; smart?: SmartSchedule };

const KIND_ORDER: Record<RhythmEvent['kind'], number> = { 'power-on': 0, temperature: 1, alarm: 2, 'power-off': 3 };
const DATE_FORMAT = 'YYYY-MM-DD';

const addDays = (date: string, days: number) => moment.utc(date, DATE_FORMAT, true).add(days, 'day').format(DATE_FORMAT);
const weekdayOf = (date: string): DayOfWeek => SCHEDULE_DAYS[moment.utc(date, DATE_FORMAT, true).day()];

// A time that does not exist on this date (spring forward) moves forward by
// the gap; a time that happens twice (fall back) takes the first occurrence.
function wallClock(date: string, time: string, timeZone: string): Date {
  return moment.tz(`${date} ${time}`, `${DATE_FORMAT} HH:mm`, true, timeZone).toDate();
}

// Times at or after power on belong to the start date, earlier ones to the next.
const dateForTime = (date: string, time: string, powerOn: string) => (compareTimes(time, powerOn) >= 0 ? date : addDays(date, 1));

function resolveNight(side: Side, date: string, source: NightSource, timeZone: string): ResolvedSleep | null {
  const night = normalizeNight(source.night);
  const { power } = night;
  if (!power.enabled || !isValidTime(power.on) || !isValidTime(power.off)) return null;
  const start = wallClock(date, power.on, timeZone);
  const end = wallClock(scheduleWrapsToNextDay(power) ? addDays(date, 1) : date, power.off, timeZone);
  // A short night starting in a spring-forward gap can lose its whole length.
  // The legacy engine skips that power on and leaves the side off.
  if (end <= start) return null;
  const events: RhythmEvent[] = [{ kind: 'power-on', at: start, temperatureF: power.onTemperature }];
  for (const [time, temperatureF] of Object.entries(night.temperatures)) {
    if (!isValidTime(time)) continue;
    events.push({ kind: 'temperature', at: wallClock(dateForTime(date, time, power.on), time, timeZone), temperatureF });
  }
  night.alarms.filter(alarm => alarm.enabled).forEach((alarm, index) => {
    if (!isValidTime(alarm.time)) return;
    events.push({ kind: 'alarm', at: wallClock(dateForTime(date, alarm.time, power.on), alarm.time, timeZone), alarm, index });
  });
  events.push({ kind: 'power-off', at: end });
  events.sort((a, b) => a.at.getTime() - b.at.getTime() || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const wakeTime = source.wake !== undefined && isValidTime(source.wake) ? source.wake : wakeFromNight(night);
  // Waking at the turn off means the end, even when off equals on.
  const wakeAt = wakeTime === power.off ? end.getTime() : wallClock(dateForTime(date, wakeTime, power.on), wakeTime, timeZone).getTime();
  const wake = new Date(Math.min(Math.max(wakeAt, start.getTime()), end.getTime()));
  const sleep: ResolvedSleep = { side, date, rhythmId: source.rhythmId, start, end, wake, night, mode: source.mode, events };
  if (source.mode === 'smart' && source.smart) sleep.smart = { ...source.smart };
  return sleep;
}

// A sleep starting the day before `from` can still be running at `from`.
function resolveWindow(window: Window, sourceFor: (date: string) => NightSource | null): ResolvedSleep[] {
  const { side, timeZone, from, to } = window;
  const last = moment.tz(to, timeZone).format(DATE_FORMAT);
  const sleeps: ResolvedSleep[] = [];
  for (let date = addDays(moment.tz(from, timeZone).format(DATE_FORMAT), -1); date <= last; date = addDays(date, 1)) {
    const source = sourceFor(date);
    const sleep = source ? resolveNight(side, date, source, timeZone) : null;
    if (sleep && sleep.start <= to && sleep.end >= from) sleeps.push(sleep);
  }
  return sleeps;
}

export function resolveSleeps(args: { db: RhythmsDB; side: Side; timeZone: string; from: Date; to: Date }): ResolvedSleep[] {
  const plan = args.db[args.side];
  return resolveWindow(args, date => {
    const change = plan.changes.find(entry => entry.date === date);
    const rhythmId = change ? change.rhythmId : plan.week[weekdayOf(date)];
    const rhythm = rhythmId && Object.hasOwn(plan.rhythms, rhythmId) ? plan.rhythms[rhythmId] : undefined;
    if (!rhythm) return null;
    return { rhythmId: rhythm.id, night: rhythm.night, wake: rhythm.wake, mode: rhythm.temperatureMode, smart: rhythm.smart };
  });
}

export function resolveLegacySleeps(args: { schedules: Schedules; side: Side; timeZone: string; from: Date; to: Date }): ResolvedSleep[] {
  return resolveWindow(args, date => ({ rhythmId: null, night: args.schedules[args.side][weekdayOf(date)], mode: 'manual' }));
}

export function findOverlaps(args: { db: RhythmsDB; side: Side; timeZone: string; from: Date; to: Date }): Overlap[] {
  const sleeps = resolveSleeps(args);
  const overlaps: Overlap[] = [];
  sleeps.forEach((sleep, index) => {
    for (const next of sleeps.slice(index + 1)) {
      if (next.start >= sleep.end) break;
      overlaps.push({ first: sleep.date, second: next.date });
    }
  });
  return overlaps;
}

// alarmsEnabled is a side setting, not schedule data, so callers apply it.
export function applyAlarmsEnabled(sleeps: ResolvedSleep[], alarmsEnabled: boolean): ResolvedSleep[] {
  if (alarmsEnabled) return sleeps;
  return sleeps.map(sleep => ({ ...sleep, events: sleep.events.filter(event => event.kind !== 'alarm') }));
}
