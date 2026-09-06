// Expand a recurring alarm's recurrence rule into concrete future occurrence
// instants in a given time zone. Used by:
//   - alarmScheduler.ts to arm node-schedule jobs for the next occurrences
//   - GET /api/alarms/upcoming to report the next occurrences to the app
//
// DST handling: occurrences are computed on the wall-clock calendar in the
// target zone (moment-timezone), so an alarm at 07:00 stays at 07:00 local
// across a spring-forward / fall-back boundary rather than drifting by an
// hour. On the fall-back day the same 07:00 exists once (07:00 is outside the
// repeated 01:00-01:59 window), so there is no duplicate to dedupe at the
// expansion layer; the runtime ALARM_DEDUPE_MS guard covers the rare case of
// an alarm actually scheduled inside the repeated hour.

import moment from 'moment-timezone';
import type { Recurrence, RecurringAlarm } from '../db/schedulesSchema.js';

// Whether a given local calendar day (its weekday 0..6 and the day itself)
// matches the recurrence rule.
function dayMatches(
  recurrence: Recurrence,
  weekday: number,
  dayStart: moment.Moment,
): boolean {
  switch (recurrence.kind) {
  case 'daily':
    return true;
  case 'weekdays':
    return weekday >= 1 && weekday <= 5;
  case 'weekends':
    return weekday === 0 || weekday === 6;
  case 'customDays':
    return recurrence.days.includes(weekday);
  case 'everyNDays': {
    // Count whole local days between the anchor date and this day; a match is
    // every n-th day. Anchor is a YYYY-MM-DD wall date in the same zone.
    const anchor = moment.tz(recurrence.anchorDate, 'YYYY-MM-DD', dayStart.tz() as string);
    if (!anchor.isValid()) return false;
    // Diff on start-of-day moments to avoid DST hour skew polluting the day
    // count.
    const diffDays = dayStart.clone().startOf('day').diff(anchor.clone().startOf('day'), 'days');
    if (diffDays < 0) return false; // before the anchor: no occurrences
    return diffDays % recurrence.n === 0;
  }
  }
}

export type Occurrence = {
  // Millisecond epoch of the occurrence (unambiguous instant).
  epochMs: number;
  // ISO 8601 with zone offset, for the API / debugging.
  iso: string;
};

/**
 * Concrete occurrences of one alarm strictly after `fromMs`, up to and
 * including `toMs`, in the given IANA time zone.
 *
 * Iterates calendar days from `from` to `to` (inclusive of the day containing
 * `to`) and, for each matching day, places the alarm at its HH:mm wall time.
 * Because we build each instant with moment.tz(...).hour().minute() the result
 * is the correct instant even across DST transitions.
 */
export function expandAlarmOccurrences(
  alarm: Pick<RecurringAlarm, 'time' | 'recurrence' | 'enabled'>,
  timeZone: string,
  fromMs: number,
  toMs: number,
): Occurrence[] {
  const out: Occurrence[] = [];
  if (!alarm.enabled) return out;
  if (toMs <= fromMs) return out;

  const [hourStr, minuteStr] = alarm.time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return out;

  // Walk calendar days in the target zone. Start at the local day of `from`
  // and stop once we pass the local day of `to`.
  const cursor = moment.tz(fromMs, timeZone).startOf('day');
  const lastDay = moment.tz(toMs, timeZone).startOf('day');

  // Hard cap the number of days scanned so a corrupt everyNDays rule with a
  // far-future anchor can't spin. 400 days is well past any /upcoming horizon
  // and any sane scheduler lookahead.
  const MAX_DAYS = 400;
  let scanned = 0;
  while (cursor.isSameOrBefore(lastDay) && scanned < MAX_DAYS) {
    const weekday = cursor.day(); // 0=Sunday..6=Saturday
    if (dayMatches(alarm.recurrence, weekday, cursor)) {
      // Build the fire instant on this calendar day at the wall HH:mm.
      const fire = cursor.clone().hour(hour).minute(minute).second(0).millisecond(0);
      const fireMs = fire.valueOf();
      if (fireMs > fromMs && fireMs <= toMs) {
        out.push({ epochMs: fireMs, iso: fire.toISOString(true) });
      }
    }
    cursor.add(1, 'day');
    scanned += 1;
  }
  return out;
}
