import { useMemo } from 'react';
import moment from 'moment-timezone';
import { VitalsRecord } from '@api/vitals.ts';
import { Box, Typography } from '@mui/material';
import { palette } from '@design/tokens';
import TimeSeriesChart, { TimeSeriesPoint } from '@design/TimeSeriesChart';
import { vitalsRecordsToPoints, VitalsMetric as Metric } from '@lib/vitalsPoints.ts';
type VitalsLineChartProps = {
  vitalsRecords?: VitalsRecord[];
  points?: TimeSeriesPoint[];
  metric: Metric;
  /** Average of this metric over the 7 days leading up to the selected
   *  night, computed from the vitals-summary endpoint by the parent. */
  sevenDayAvg?: number;
  timeZone?: string;
  startTime?: string;
  endTime?: string;
};

const METRIC_CONFIG: Record<Metric, { unit: string; targetRange?: [number, number] }> = {
  heart_rate: { unit: 'bpm' },
  hrv: { unit: 'ms', targetRange: [50, 100] },
  breathing_rate: { unit: 'breaths/min', targetRange: [12, 20] },
};

// Bucket-aggregate timestamped points: split into ~maxPoints contiguous
// buckets and emit the mean of each bucket (using the bucket's middle
// timestamp). Smoother trend than naive every-Nth-point decimation, since
// it averages out jitter rather than just dropping in-between samples.
function bucketAggregate(arr: TimeSeriesPoint[], maxPoints: number): TimeSeriesPoint[] {
  if (arr.length <= maxPoints) return arr;
  const bucketSize = Math.ceil(arr.length / maxPoints);
  const out: TimeSeriesPoint[] = [];
  for (let i = 0; i < arr.length; i += bucketSize) {
    const slice = arr.slice(i, i + bucketSize);
    const meanValue = slice.reduce((s, p) => s + p.value, 0) / slice.length;
    const midIdx = Math.floor(slice.length / 2);
    out.push({ timestamp: slice[midIdx].timestamp, value: meanValue });
  }
  return out;
}

export default function VitalsLineChart({
  vitalsRecords, points: suppliedPoints, metric, sevenDayAvg, timeZone, startTime, endTime,
}: VitalsLineChartProps) {
  const cfg = METRIC_CONFIG[metric];
  const points = useMemo(() => bucketAggregate(
    suppliedPoints ?? vitalsRecordsToPoints(vitalsRecords ?? [], metric, { startTime, endTime }), 50,
  ), [suppliedPoints, vitalsRecords, metric, startTime, endTime]);
  if (!points.length) return null;
  const spanMs = points[points.length - 1].timestamp.getTime() - points[0].timestamp.getTime();
  const timeFormat = spanMs > 24 * 60 * 60 * 1000 ? 'ddd h:mm A' : 'h:mm A';

  return (
    <Box>
      { !!sevenDayAvg && sevenDayAvg > 0 && (
        <Typography variant="body2" color="text.secondary" sx={ { mb: 1 } }>
          7-night average { Math.round(sevenDayAvg) } { cfg.unit }
        </Typography>
      ) }
      <TimeSeriesChart
        data={ points }
        startTime={ startTime }
        endTime={ endTime }
        lineColor={ palette.lamp }
        targetRange={ cfg.targetRange }
        xValueFormatter={ date => (timeZone ? moment.tz(date, timeZone) : moment(date)).format(timeFormat) }
        yValueFormatter={ value => Math.round(value).toString() }/>
    </Box>
  );
}
