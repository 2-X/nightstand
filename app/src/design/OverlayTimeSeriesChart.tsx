import { LineChart } from '@mui/x-charts/LineChart';
import { Box } from '@mui/material';
import { useResizeDetector } from 'react-resize-detector';
import { palette } from './tokens';
import { OverlayRow } from '@lib/overlaySeries';

type OverlayTimeSeriesChartProps = {
  /** Resampled rows from buildOverlayRows (shared x, one column per side). */
  rows: OverlayRow[];
  leftColor: string;
  rightColor: string;
  height?: number;
  /** Format an x-axis tick (timestamp). Default = "7pm" style. */
  xValueFormatter?: (date: Date) => string;
  /** Format a y-axis tick. Default = integer string. */
  yValueFormatter?: (n: number) => string;
};

/**
 * Two-series time chart overlaying the left and right sides of the bed on
 * shared axes - the comparison view used on the live Vitals page.
 *
 * Follows the same visual conventions as TimeSeriesChart (dotted grey grid,
 * dim axis labels, transparent axis lines) but draws one colored line per
 * side and no per-point markers, since two marker sets on one plot read as
 * clutter. Gaps in one side's data (nulls) are bridged with connectNulls so
 * a mid-night bathroom break doesn't sever the line.
 */
export default function OverlayTimeSeriesChart({
  rows,
  leftColor,
  rightColor,
  height = 200,
  xValueFormatter,
  yValueFormatter,
}: OverlayTimeSeriesChartProps) {
  const { width = 320, ref } = useResizeDetector();
  const fmtX = xValueFormatter ?? ((d: Date) => d.toLocaleTimeString([], { hour: 'numeric' }).toLowerCase().replace(' ', ''));
  const fmtY = yValueFormatter ?? ((n: number) => Math.round(n).toString());

  // Y range across both sides, padded 10% so lines don't touch the frame.
  const values = rows
    .flatMap((row) => [row.left, row.right])
    .filter((v): v is number => v != null && Number.isFinite(v));
  const yMin = values.length ? Math.min(...values) : 0;
  const yMax = values.length ? Math.max(...values) : 1;
  const ySpan = yMax - yMin || 1;

  return (
    <Box ref={ ref } sx={ { width: '100%', touchAction: 'pan-y' } }>
      <LineChart
        width={ width }
        height={ height }
        // Same known-good margins as TimeSeriesChart: room on the left for
        // 3-digit y labels, bottom for time labels.
        margin={ { top: 12, bottom: 32, left: 38, right: 12 } }
        // No mount animation: this chart lives on a polling page, so the
        // expanding-clip line animation would replay on refetches (and can
        // freeze mid-draw in throttled/background tabs, truncating the line).
        skipAnimation
        xAxis={ [{
          data: rows.map((row) => row.timestamp),
          scaleType: 'time',
          valueFormatter: (v) => fmtX(v as Date),
          tickLabelStyle: { fill: palette.text.tertiary, fontSize: 11 },
          stroke: 'transparent',
          tickSize: 0,
        }] }
        yAxis={ [{
          min: yMin - ySpan * 0.1,
          max: yMax + ySpan * 0.1,
          position: 'left',
          valueFormatter: fmtY,
          tickLabelStyle: { fill: palette.text.tertiary, fontSize: 11 },
          stroke: 'transparent',
          tickSize: 0,
        }] }
        grid={ { horizontal: true, vertical: true } }
        series={ [
          {
            data: rows.map((row) => row.left),
            color: leftColor,
            showMark: false,
            curve: 'linear',
            connectNulls: true,
            valueFormatter: (v) => (v == null ? '' : fmtY(v)),
          },
          {
            data: rows.map((row) => row.right),
            color: rightColor,
            showMark: false,
            curve: 'linear',
            connectNulls: true,
            valueFormatter: (v) => (v == null ? '' : fmtY(v)),
          },
        ] }
        sx={ {
          '& .MuiChartsAxis-line': { stroke: 'transparent' },
          '& .MuiChartsAxis-tick': { stroke: 'transparent' },
          '& .MuiChartsGrid-line': {
            stroke: 'rgba(255,255,255,0.06)',
            strokeDasharray: '2 4',
          },
          '& .MuiLineElement-root': { strokeWidth: 1.5 },
          '& .MuiChartsLegend-root': { display: 'none' },
        } }
      />
    </Box>
  );
}
