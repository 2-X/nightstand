import { useMemo } from 'react';
import moment from 'moment-timezone';
import { VitalsRecord } from '@api/vitals.ts';
import { Box, Typography } from '@mui/material';
import { palette } from '@design/tokens';
import TimeSeriesChart, { TimeSeriesPoint } from '@design/TimeSeriesChart';
import { splitAtGaps, vitalsRecordsToPoints, VitalsMetric as Metric } from '@lib/vitalsPoints.ts';
type VitalsLineChartProps = {
  vitalsRecords?: VitalsRecord[];
  points?: Point[];
  metric: Metric;
  /** Average of this metric over the 7 days leading up to the selected
   *  night, computed from the vitals-summary endpoint by the parent. */
  sevenDayAvg?: number;
  timeZone?: string;
  startTime?: string;
  endTime?: string;
};

type Point = { timestamp: Date; value: number };

const METRIC_UNITS: Record<Metric, string> = {
  heart_rate: 'bpm',
  hrv: 'ms',
  breathing_rate: 'breaths/min',
  resp_rate: 'breaths/min',
};

// Bucket-aggregate timestamped points: split into ~maxPoints contiguous
// buckets and emit the mean of each bucket (using the bucket's middle
// timestamp). Smoother trend than naive every-Nth-point decimation, since
// it averages out jitter rather than just dropping in-between samples.
// Each run between holes is bucketed on its own, and a null marks the hole.
function bucketAggregate(arr: Point[], maxPoints: number): TimeSeriesPoint[] {
  const bucketSize = Math.max(1, Math.ceil(arr.length / maxPoints));
  const out: TimeSeriesPoint[] = [];
  for (const run of splitAtGaps(arr)) {
    if (out.length) {
      const last = out[out.length - 1].timestamp.getTime();
      out.push({ timestamp: new Date((last + run[0].timestamp.getTime()) / 2), value: null });
    }
    for (let i = 0; i < run.length; i += bucketSize) {
      const slice = run.slice(i, i + bucketSize);
      const meanValue = slice.reduce((s, p) => s + p.value, 0) / slice.length;
      const midIdx = Math.floor(slice.length / 2);
      out.push({ timestamp: slice[midIdx].timestamp, value: meanValue });
    }
  }
  return out;
}

export default function VitalsLineChart({
  vitalsRecords, points: suppliedPoints, metric, sevenDayAvg, timeZone, startTime, endTime,
}: VitalsLineChartProps) {
  const unit = METRIC_UNITS[metric];
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
          7-night average { Math.round(sevenDayAvg) } { unit }
        </Typography>
      ) }
      <TimeSeriesChart
        data={ points }
        startTime={ startTime }
        endTime={ endTime }
        lineColor={ palette.lamp }
        xValueFormatter={ date => (timeZone ? moment.tz(date, timeZone) : moment(date)).format(timeFormat) }
        yValueFormatter={ value => Math.round(value).toString() }/>
    </Box>
  );
}
