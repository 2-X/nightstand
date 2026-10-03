import moment from 'moment-timezone';
import type { SleepRecord } from '@api/sleepSchema';

export const SLEEP_GOAL_MIN_SECONDS = 7 * 3600;
export const SLEEP_GOAL_MAX_SECONDS = 9 * 3600;
export const SLEEP_RANGE_TEXT = '7h to 9h';
export const SLEEP_RANGE_SOURCE = 'The 7 to 9 hour range is the National Sleep Foundation\'s recommendation for adults 18 to 64 '
  + '(Hirshkowitz et al., Sleep Health, 2015), also in line with the AASM and SRS consensus of 7 or more hours '
  + '(Watson et al., 2015). It is a general guide, not advice for you.';

// Week-strip bar height in px: proportional from 0 up to the top of the goal range.
export const nightMarkHeight = (seconds: number) =>
  Math.round(4 + 36 * Math.min(1, Math.max(0, seconds) / SLEEP_GOAL_MAX_SECONDS));

// A record that ends after now is a clock error, not a night that happened.
// The hour of grace covers a phone clock that runs slightly behind the Pod.
const FUTURE_GRACE_MS = 60 * 60 * 1000;
export function withoutFutureRecords(records: SleepRecord[], nowMs: number) {
  return records.filter(record => Date.parse(record.left_bed_at) <= nowMs + FUTURE_GRACE_MS);
}

// Nights belong to their wake date in the Pod timezone. Weekly aggregates
// filter the full recording history to these boundaries.
export function recordsInWeek(records: SleepRecord[] | undefined, weekStart: moment.Moment, timeZone: string) {
  const end = weekStart.clone().add(7, 'days');
  return (records ?? []).filter(record => {
    const wake = moment.tz(record.left_bed_at, timeZone);
    return wake.isSameOrAfter(weekStart) && wake.isBefore(end);
  });
}

export function recordForNight(records: SleepRecord[], date: string, timeZone: string) {
  return records.filter(record => moment.tz(record.left_bed_at, timeZone).format('YYYY-MM-DD') === date)
    .sort((left, right) => right.sleep_period_seconds - left.sleep_period_seconds)[0];
}

export function formatSleepDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
}


export type NightDuration = { seconds: number; kind: 'in bed' };

// Time in bed is the only duration shown until sleep onset can be detected reliably.
export function nightDuration(secondsInBed: number): NightDuration {
  return { seconds: secondsInBed, kind: 'in bed' };
}

export function summarizeDurations(durations: NightDuration[]) {
  if (!durations.length) return undefined;
  return {
    nights: durations.length,
    average: durations.reduce((total, duration) => total + duration.seconds, 0) / durations.length,
  };
}
