import { VitalsRecord } from '@api/vitals.ts';

export type VitalsMetric = 'heart_rate' | 'hrv' | 'breathing_rate' | 'resp_rate';

// Readings the sleep score and 7-night average use for HRV (the Pod's
// plausibility window), so the headline and chart agree with them.
export const HRV_RANGE = [30, 120] as const;

export type VitalsPoint = { timestamp: Date; value: number };

/**
 * Convert raw vitals records into chart points for one metric.
 *
 * `VitalsRecord.timestamp` is epoch SECONDS (see server
 * `vitalsRecordSchema.ts`; the stream writes `moment().unix()`), so it must
 * be scaled to milliseconds before `new Date()` - passing it through
 * directly puts every point in January 1970 and collapses the x-axis into
 * one repeated tick label.
 */
export function vitalsRecordsToPoints(
  records: VitalsRecord[],
  metric: VitalsMetric,
  window?: { startTime?: string; endTime?: string },
): VitalsPoint[] {
  return records
    .filter((r) => Number.isFinite(r.timestamp) && Number.isFinite(r[metric] as number))
    .map((r) => ({ timestamp: new Date(r.timestamp * 1000), value: Number(r[metric]) }))
    .filter((r) => r.value > 0)
    .filter((r) => metric !== 'hrv' || (r.value >= HRV_RANGE[0] && r.value <= HRV_RANGE[1]))
    .filter(point => (!window?.startTime || point.timestamp.getTime() >= Date.parse(window.startTime))
      && (!window?.endTime || point.timestamp.getTime() <= Date.parse(window.endTime)));
}

// Vitals rows come about a minute apart: the newer writer stamps each minute, while the older one counts sensor
// iterations, so its rows land 40 to 80 seconds apart and now and then a little more. One missing row leaves about
// two minutes, so anything past 115 seconds is a hole.
const ROW_GAP_MS = 115_000;

// Runs of readings with no missing row between them, in time order, so a chart can break its line at every hole
// instead of drawing a trend nobody recorded.
export function splitAtGaps<T extends { timestamp: Date }>(points: T[]): T[][] {
  const sorted = [...points].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const runs: T[][] = [];
  sorted.forEach((point, index) => {
    if (index === 0 || point.timestamp.getTime() - sorted[index - 1].timestamp.getTime() > ROW_GAP_MS) runs.push([]);
    runs[runs.length - 1].push(point);
  });
  return runs;
}
