import moment from 'moment-timezone';
import { nextBedEvent, type BedSchedule } from './bedEvents';

export const MAX_PAUSE_DAYS = 14;
// Same fallback as the rest of the app when the Pod's time zone is unset.
const UNSET_ZONE = 'UTC';
const DAY_MS = 24 * 60 * 60 * 1000;

// When the side next powers on or off after a moment: from the weekly
// schedule, or from the resolved sleeps while Rhythms runs.
export type NextBedTime = (after: moment.Moment, kind: 'on' | 'off') => moment.Moment | undefined;

export const weeklyTimes = (schedule: BedSchedule, timeZone: string): NextBedTime =>
  (after, kind) => nextBedEvent(schedule, timeZone, after, kind)?.at;

// Tonight's power off when one is due within a day. Otherwise noon: today
// before 6 AM, when tonight is still going, and tomorrow after that.
export function tonightOnlyEndWith(next: NextBedTime, timeZone: string, now = moment.tz(timeZone || UNSET_ZONE)): moment.Moment {
  const zone = timeZone || UNSET_ZONE;
  const local = now.clone().tz(zone);
  const off = next(local, 'off');
  if (off && off.diff(local) <= DAY_MS) return off;
  const noon = local.clone().startOf('day').hour(12);
  return local.hour() < 6 ? noon : noon.add(1, 'day');
}

// The side's next bedtime after a "Tonight only" pause would end.
export function setTimeDefaultWith(next: NextBedTime, timeZone: string, now = moment.tz(timeZone || UNSET_ZONE)): moment.Moment {
  const tonight = tonightOnlyEndWith(next, timeZone, now);
  return next(tonight, 'on') ?? tonight.clone().add(1, 'day');
}

export function tonightOnlyEnd(schedule: BedSchedule, timeZone: string, now = moment.tz(timeZone || UNSET_ZONE)): moment.Moment {
  return tonightOnlyEndWith(weeklyTimes(schedule, timeZone || UNSET_ZONE), timeZone, now);
}

export function setTimeDefault(schedule: BedSchedule, timeZone: string, now = moment.tz(timeZone || UNSET_ZONE)): moment.Moment {
  return setTimeDefaultWith(weeklyTimes(schedule, timeZone || UNSET_ZONE), timeZone, now);
}

export function formatPauseEnd(end: moment.Moment, timeZone: string, now = moment.tz(timeZone || UNSET_ZONE)): string {
  const zone = timeZone || UNSET_ZONE;
  const local = end.clone().tz(zone);
  const today = now.clone().tz(zone);
  const time = local.format('h:mm A');
  if (local.isSame(today, 'day')) return `${time} today`;
  if (local.isSame(today.clone().add(1, 'day'), 'day')) return `${time} tomorrow`;
  return local.format('ddd, MMM D [at] h:mm A');
}

export function pauseEndError(end: moment.Moment, now: moment.Moment): string | null {
  if (!end.isAfter(now)) return 'Pick a time in the future';
  if (end.diff(now) > MAX_PAUSE_DAYS * DAY_MS) return 'Pick a time within 14 days';
  return null;
}
