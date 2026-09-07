import { SleepRecord } from '../../../server/src/db/sleepRecordsSchema';

/**
 * Decide which sleep record the Sleep page should show after a fetch.
 *
 * Keeps the user's current selection whenever the fetched set still contains
 * it, and only falls back to the most recent record otherwise (first load,
 * side switch, week change). The "still contains" check must be by id, not
 * reference: react-query returns a fresh array identity on every refetch
 * (day clicks shift the query window, and window focus refetches), and
 * re-selecting the last record on each of those made every clicked night
 * snap back to the latest one.
 */
export function reconcileSelectedRecord(
  current: SleepRecord | undefined,
  records: SleepRecord[],
): SleepRecord | undefined {
  const stillPresent = current
    && records.some((record) => record.id === current.id && record.side === current.side);
  return stillPresent ? current : records[records.length - 1];
}
