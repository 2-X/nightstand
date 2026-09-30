import moment from 'moment-timezone';
import type { SleepStagesResponse } from '@api/sleepStages';
import type { SleepRecord } from '@api/sleepSchema';

export const SLEEP_GOAL_MIN_SECONDS = 6.5 * 3600;
export const SLEEP_GOAL_MAX_SECONDS = 9 * 3600;

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


export type NightDuration = { seconds: number; kind: 'asleep' | 'in bed' };

export function nightDuration(secondsInBed: number, stages?: SleepStagesResponse): NightDuration {
  return stages?.active && stages.epochs.length > 0 && !stages.lowCoverage
    ? { seconds: stages.totals.light + stages.totals.rem + stages.totals.deep, kind: 'asleep' }
    : { seconds: secondsInBed, kind: 'in bed' };
}

// Keep estimates and bed presence separate when stage coverage varies by night.
export function summarizeDurations(durations: NightDuration[]) {
  return (['asleep', 'in bed'] as const).flatMap(kind => {
    const matching = durations.filter(duration => duration.kind === kind);
    return matching.length ? [{
      kind, nights: matching.length,
      average: matching.reduce((total, duration) => total + duration.seconds, 0) / matching.length,
    }] : [];
  });
}

export function contributorBand(score: number) {
  return score >= 85 ? 'Good' : score >= 70 ? 'Fair' : 'Low';
}
