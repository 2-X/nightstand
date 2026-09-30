import moment from 'moment-timezone';
import { DateChange, MAX_RHYTHMS_PER_SIDE, SideRhythms } from '../../db/rhythmsSchema.js';
import { MAX_TEMPERATURES_PER_DAY } from '../../db/schedulesSchema.js';
import { SCHEDULE_DAYS } from '../../db/scheduleKeys.js';

export const MAX_CHANGE_DAYS_AHEAD = 60;
export const KEEP_PAST_CHANGE_DAYS = 7;

const DATE_FORMAT = 'YYYY-MM-DD';
const exists = (side: SideRhythms, id: string) => Object.hasOwn(side.rhythms, id);
const dayName = (day: string) => day[0].toUpperCase() + day.slice(1);
const shift = (date: string, days: number) => moment.utc(date, DATE_FORMAT, true).add(days, 'day').format(DATE_FORMAT);

// Changes more than a week old no longer matter to any sleep.
export function pruneChanges(changes: DateChange[], today: string): DateChange[] {
  const oldest = shift(today, -KEEP_PAST_CHANGE_DAYS);
  return changes.filter(change => change.date >= oldest);
}

// Rules the schema cannot express. Each issue names what to fix. `stored` is
// the side as saved: a rhythm may keep a set point count above the weekly
// schedule's write cap that it already has, but not grow it.
export function sideIssues(side: SideRhythms, today: string, stored?: SideRhythms): string[] {
  const issues: string[] = [];
  const ids = Object.keys(side.rhythms);
  if (ids.length > MAX_RHYTHMS_PER_SIDE) issues.push(`A side can have at most ${MAX_RHYTHMS_PER_SIDE} rhythms`);
  for (const id of ids) {
    if (side.rhythms[id].id !== id) issues.push(`Rhythm ${id} is stored under a different id (${side.rhythms[id].id})`);
    const count = Object.keys(side.rhythms[id].night.temperatures).length;
    const storedNight = stored && exists(stored, id) ? stored.rhythms[id].night : undefined;
    const limit = Math.max(MAX_TEMPERATURES_PER_DAY, Object.keys(storedNight?.temperatures ?? {}).length);
    if (count > limit) issues.push(`Rhythm ${id} can have at most ${limit} temperature changes`);
  }
  for (const day of SCHEDULE_DAYS) {
    const id = side.week[day];
    if (id && !exists(side, id)) issues.push(`The ${dayName(day)} plan uses a rhythm that does not exist (${id})`);
  }
  const latest = shift(today, MAX_CHANGE_DAYS_AHEAD);
  const seen = new Set<string>();
  for (const change of side.changes) {
    const real = moment.utc(change.date, DATE_FORMAT, true).isValid();
    if (!real) issues.push(`${change.date} is not a real date`);
    else if (change.date > latest) issues.push(`${change.date} is more than ${MAX_CHANGE_DAYS_AHEAD} days ahead`);
    if (real && seen.has(change.date)) issues.push(`${change.date} has more than one change`);
    seen.add(change.date);
    if (change.rhythmId && !exists(side, change.rhythmId)) {
      issues.push(`The change on ${change.date} uses a rhythm that does not exist (${change.rhythmId})`);
    }
  }
  // A date repeated several times is named once for each problem.
  return [...new Set(issues)];
}
