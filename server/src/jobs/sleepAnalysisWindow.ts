import moment from 'moment-timezone';

/** Calendar day ending at the run: includes pre-midnight sleep across DST. */
export function sleepAnalysisWindow(now: moment.Moment) {
  return { startTime: now.clone().subtract(1, 'day').toISOString(), endTime: now.toISOString() };
}
