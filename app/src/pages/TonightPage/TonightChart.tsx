import { Box } from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import { useResizeDetector } from 'react-resize-detector';
import moment from 'moment-timezone';
import { palette } from '@design/tokens';

// Teal used for the temperature curves (design language: #5DCAA5).
const TEAL = '#5DCAA5';
// Orange "now" cursor, purple alarm flags (per the approved mockup).
const NOW_ORANGE = palette.accent.orange;
const ALARM_PURPLE = palette.accent.purple;

export type ChartPoint = { ts: number; value: number };
export type AlarmMarker = { ts: number; label: string };

type Props = {
  // Solid line: water temperature actually recorded so far.
  actual: ChartPoint[];
  // Dashed line: planned setpoint curve for the rest of the night.
  projected: ChartPoint[];
  nowMs: number;
  windowStartMs: number;
  windowEndMs: number;
  alarms: AlarmMarker[];
  timeZone: string;
  height?: number;
};

const fmtClock = (ts: number, tz: string) => moment.tz(ts, tz).format('h:mma').replace(':00', '');

/**
 * The Tonight temperature chart: solid teal actual (water) temp, dashed teal
 * projected schedule, an orange "now" reference line, and purple alarm markers.
 *
 * x-charts wants each series aligned to a shared x dataset, so we merge the two
 * series onto a single sorted set of timestamps and leave the other series null
 * at timestamps it doesn't own (nulls create gaps, which is what we want — the
 * actual line stops at "now", the projected line starts there).
 */
export default function TonightChart({
  actual,
  projected,
  nowMs,
  windowStartMs,
  windowEndMs,
  alarms,
  timeZone,
  height = 260,
}: Props) {
  const { width = 340, ref } = useResizeDetector();

  // Union of all timestamps, clipped to the window.
  const tsSet = new Set<number>();
  for (const p of actual) if (p.ts >= windowStartMs && p.ts <= windowEndMs) tsSet.add(p.ts);
  for (const p of projected) if (p.ts >= windowStartMs && p.ts <= windowEndMs) tsSet.add(p.ts);
  const xs = Array.from(tsSet).sort((a, b) => a - b);

  const actualByTs = new Map(actual.map((p) => [p.ts, p.value]));
  const projByTs = new Map(projected.map((p) => [p.ts, p.value]));

  const actualSeries = xs.map((ts) => actualByTs.get(ts) ?? null);
  const projSeries = xs.map((ts) => projByTs.get(ts) ?? null);

  // Y range across both series, padded.
  const allVals = [...actual, ...projected].map((p) => p.value).filter((v) => Number.isFinite(v));
  const yMin = allVals.length ? Math.min(...allVals) : 55;
  const yMax = allVals.length ? Math.max(...allVals) : 110;
  const ySpan = yMax - yMin || 1;

  return (
    <Box ref={ ref } sx={ { width: '100%', touchAction: 'pan-y' } }>
      <LineChart
        width={ width }
        height={ height }
        margin={ { top: 16, bottom: 28, left: 38, right: 12 } }
        xAxis={ [{
          data: xs,
          scaleType: 'time',
          min: windowStartMs,
          max: windowEndMs,
          valueFormatter: (v: number) => fmtClock(v, timeZone),
          tickLabelStyle: { fill: palette.text.tertiary, fontSize: 11 },
          tickSize: 0,
        }] }
        yAxis={ [{
          min: yMin - ySpan * 0.15,
          max: yMax + ySpan * 0.15,
          position: 'left',
          valueFormatter: (n: number) => `${Math.round(n)}°`,
          tickLabelStyle: { fill: palette.text.tertiary, fontSize: 11 },
          tickSize: 0,
        }] }
        series={ [
          {
            id: 'actual',
            data: actualSeries,
            label: 'water temp',
            color: TEAL,
            curve: 'monotoneX',
            showMark: false,
            connectNulls: false,
            valueFormatter: (v) => (v == null ? '' : `${Math.round(v)}°F`),
          },
          {
            id: 'planned',
            data: projSeries,
            label: 'planned',
            color: TEAL,
            curve: 'stepAfter',
            showMark: false,
            connectNulls: true,
            valueFormatter: (v) => (v == null ? '' : `${Math.round(v)}°F planned`),
          },
        ] }
        grid={ { horizontal: true } }
        slotProps={ { legend: { hidden: true } as never } }
        sx={ {
          '& .MuiChartsAxis-line': { stroke: 'transparent' },
          '& .MuiChartsAxis-tick': { stroke: 'transparent' },
          '& .MuiChartsGrid-line': { stroke: 'rgba(255,255,255,0.06)', strokeDasharray: '2 4' },
          '& .MuiLineElement-root': { strokeWidth: 2 },
          // The projected line (series id 'planned') is drawn dashed + dimmed;
          // x-charts tags each path with a series-<id> class.
          '& .MuiLineElement-series-planned': { strokeDasharray: '5 5', strokeWidth: 1.5, opacity: 0.7 },
        } }
      >
        <ChartsReferenceLine
          x={ nowMs }
          lineStyle={ { stroke: NOW_ORANGE, strokeWidth: 1.5 } }
          label="now"
          labelStyle={ { fill: NOW_ORANGE, fontSize: 10 } }
          labelAlign="start"
        />
        { alarms.map((a) => (
          <ChartsReferenceLine
            key={ a.ts }
            x={ a.ts }
            lineStyle={ { stroke: ALARM_PURPLE, strokeWidth: 1.5, strokeDasharray: '2 3' } }
            label={ a.label }
            labelStyle={ { fill: ALARM_PURPLE, fontSize: 10 } }
            labelAlign="end"
          />
        )) }
      </LineChart>
    </Box>
  );
}
