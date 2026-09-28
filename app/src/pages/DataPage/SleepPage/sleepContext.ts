import moment from 'moment-timezone';
import type { SleepRecord } from '@api/sleepSchema';

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
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}
