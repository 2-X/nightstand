// A causal "probably asleep" estimate from live heart rate, recorded for
// tuning only. Baseline: the side's p10 heart rate over the previous 7 days.
// It fires when the 5-row rolling median stays at or below baseline + 6 bpm
// for 10 rows in a row (about 10 minutes).
export type HeartRateRow = { at: number; hr: number | null };
export type OnsetNote = 'hr-causal' | 'no-vitals' | 'no-baseline' | 'not-reached';
export type OnsetResult = { at: number | null; note: OnsetNote };

export const ONSET_BASELINE_DAYS = 7;
export const ONSET_MARGIN_BPM = 6;
export const ONSET_MEDIAN_ROWS = 5;
export const ONSET_RUN_ROWS = 10;
export const ONSET_MIN_BASELINE_ROWS = 120;

const isValid = (hr: number | null): hr is number => hr !== null && hr >= 40 && hr <= 90;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function estimateOnset(night: HeartRateRow[], baseline: HeartRateRow[]): OnsetResult {
  const rows = night
    .filter((row): row is { at: number; hr: number } => isValid(row.hr))
    .sort((a, b) => a.at - b.at);
  if (rows.length === 0) return { at: null, note: 'no-vitals' };
  const history = baseline.map(row => row.hr).filter(isValid).sort((a, b) => a - b);
  if (history.length < ONSET_MIN_BASELINE_ROWS) return { at: null, note: 'no-baseline' };

  const threshold = history[Math.floor(0.1 * (history.length - 1))] + ONSET_MARGIN_BPM;
  const recent: number[] = [];
  let run = 0;
  for (const row of rows) {
    recent.push(row.hr);
    if (recent.length > ONSET_MEDIAN_ROWS) recent.shift();
    if (recent.length < ONSET_MEDIAN_ROWS) continue;
    run = median(recent) <= threshold ? run + 1 : 0;
    if (run >= ONSET_RUN_ROWS) return { at: row.at, note: 'hr-causal' };
  }
  return { at: null, note: 'not-reached' };
}
