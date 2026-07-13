import { VitalsRecord } from '@api/vitals.ts';

export type VitalsMetric = 'heart_rate' | 'hrv' | 'breathing_rate';

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
): VitalsPoint[] {
  return records
    .filter((r) => Number.isFinite(r.timestamp) && Number.isFinite(r[metric] as number))
    .map((r) => ({ timestamp: new Date(r.timestamp * 1000), value: Number(r[metric]) }))
    .filter((r) => r.value > 0);
}
