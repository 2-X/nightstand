import { useEffect, useMemo, useState } from 'react';
import { Box, Chip, Typography } from '@mui/material';
import moment from 'moment-timezone';
import FavoriteIcon from '@mui/icons-material/Favorite';

import Header from '../Header.tsx';
import PageContainer from '../../PageContainer.tsx';
import PersonCard, { LatestVital } from './PersonCard.tsx';
import MetricChartCard from '@design/MetricChartCard';
import OverlayTimeSeriesChart from '@design/OverlayTimeSeriesChart';
import ErrorBoundary from '@components/ErrorBoundary.tsx';
import { palette } from '@design/tokens';

import { useSettings } from '@api/settings.ts';
import { usePresence } from '@api/presence.ts';
import { useDeviceStatus } from '@api/deviceStatus';
import { useVitalsRecords, VitalsRecord } from '@api/vitals.ts';
import { useTemperatureHistory } from '@api/temperature.ts';
import { vitalsRecordsToPoints, VitalsMetric } from '@lib/vitalsPoints.ts';
import { buildOverlayRows, OverlayPoint, OverlayRow } from '@lib/overlaySeries';

// Series identity colors: blue = left, pink = right, everywhere on this page
// (person cards, chart lines, and the per-side stat numbers that act as the
// chart legend).
const SIDE_COLORS = { left: palette.accent.blue, right: palette.accent.pink };

// Selectable lookback windows. 12h ≈ "tonight" and is the default.
const WINDOW_OPTIONS: { hours: number; label: string }[] = [
  { hours: 3, label: '3h' },
  { hours: 12, label: '12h' },
  { hours: 24, label: '24h' },
];

// Vitals rows land in the DB about once a minute while someone is in bed
// (biometrics stream insertion_frequency), so a 30s poll tracks "live"
// closely without hammering the Pod.
const VITALS_POLL_MS = 30_000;

// Query windows are anchored to a 5-minute boundary so the react-query keys
// (which include start/end times) stay stable between polls - otherwise every
// tick would be a brand-new cache entry and the charts would flash empty
// while refetching.
const WINDOW_ANCHOR_MS = 5 * 60 * 1000;

type MetricConfig = { metric: VitalsMetric; title: string; unit: string };
const METRIC_CHARTS: MetricConfig[] = [
  { metric: 'heart_rate', title: 'HEART RATE', unit: 'bpm' },
  { metric: 'hrv', title: 'HRV', unit: 'ms' },
  { metric: 'breathing_rate', title: 'BREATHING RATE', unit: 'brpm' },
];

// Most recent positive reading of one metric across a side's records.
function latestVital(records: VitalsRecord[] | undefined, metric: VitalsMetric): LatestVital | undefined {
  let best: LatestVital | undefined;
  for (const record of records ?? []) {
    const value = Number(record[metric]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const timestampMs = record.timestamp * 1000;
    if (!best || timestampMs > best.timestampMs) best = { value, timestampMs };
  }
  return best;
}

export default function VitalsPage() {
  const { data: settings } = useSettings();
  const { data: presence } = usePresence();
  const { data: deviceStatus } = useDeviceStatus();
  const timeZone = settings?.timeZone || moment.tz.guess() || 'UTC';

  const [windowHours, setWindowHours] = useState(12);

  // Tick each minute so relative labels ("2 minutes ago") and the live
  // temperature append advance between fetches.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const anchoredEndMs = Math.ceil(nowMs / WINDOW_ANCHOR_MS) * WINDOW_ANCHOR_MS;
  const windowStartMs = anchoredEndMs - windowHours * 3600e3;
  const startTime = new Date(windowStartMs).toISOString();
  const endTime = new Date(anchoredEndMs).toISOString();

  const { data: leftVitals } = useVitalsRecords({ side: 'left', startTime, endTime }, true, VITALS_POLL_MS);
  const { data: rightVitals } = useVitalsRecords({ side: 'right', startTime, endTime }, true, VITALS_POLL_MS);
  const { data: leftTempHistory } = useTemperatureHistory({ side: 'left', startTime, endTime });
  const { data: rightTempHistory } = useTemperatureHistory({ side: 'right', startTime, endTime });

  // One resampled overlay per vitals metric (left + right on shared axes).
  // Records are re-clamped to the window client-side: the server filters by
  // time already, but the demo-mode mock does not, and the belt-and-braces
  // keeps the chart honest either way.
  const metricRows = useMemo(() => {
    const inWindow = (records: VitalsRecord[] | undefined) =>
      (records ?? []).filter((record) => record.timestamp * 1000 >= windowStartMs);
    const rows: Partial<Record<VitalsMetric, OverlayRow[]>> = {};
    for (const { metric } of METRIC_CHARTS) {
      rows[metric] = buildOverlayRows(
        vitalsRecordsToPoints(inWindow(leftVitals), metric),
        vitalsRecordsToPoints(inWindow(rightVitals), metric),
      );
    }
    return rows;
  }, [leftVitals, rightVitals, windowStartMs]);

  // Bed temperature overlay, live-appending the current device-status reading
  // so the lines reach "now" between history refetches (same trick as the
  // Tonight page).
  const temperatureRows = useMemo(() => {
    const toPoints = (history: typeof leftTempHistory, side: 'left' | 'right'): OverlayPoint[] => {
      const points: OverlayPoint[] = (history ?? [])
        .filter((sample) => typeof sample.current_temp_f === 'number')
        .map((sample) => ({ timestamp: new Date(sample.timestamp * 1000), value: sample.current_temp_f as number }));
      const live = deviceStatus?.[side];
      if (live?.isOn && typeof live.currentTemperatureF === 'number') {
        const lastMs = points.length ? points[points.length - 1].timestamp.getTime() : 0;
        if (nowMs > lastMs) points.push({ timestamp: new Date(nowMs), value: live.currentTemperatureF });
      }
      return points;
    };
    return buildOverlayRows(toPoints(leftTempHistory, 'left'), toPoints(rightTempHistory, 'right'));
  }, [leftTempHistory, rightTempHistory, deviceStatus, nowMs]);

  const leftName = settings?.left?.name || 'Left';
  const rightName = settings?.right?.name || 'Right';

  const latest = useMemo(() => ({
    left: {
      heart_rate: latestVital(leftVitals, 'heart_rate'),
      hrv: latestVital(leftVitals, 'hrv'),
      breathing_rate: latestVital(leftVitals, 'breathing_rate'),
    },
    right: {
      heart_rate: latestVital(rightVitals, 'heart_rate'),
      hrv: latestVital(rightVitals, 'hrv'),
      breathing_rate: latestVital(rightVitals, 'breathing_rate'),
    },
  }), [leftVitals, rightVitals]);

  // Short windows put ticks on sub-hour marks, where a bare "9 pm" label
  // repeats; include minutes there.
  const tickFormat = windowHours <= 3 ? 'h:mm a' : 'h a';
  const formatTick = (date: Date) => moment.tz(date, timeZone).format(tickFormat).toLowerCase();

  // Chart-header stat pair: each side's latest value in its series color, so
  // the numbers themselves are the legend.
  const sideStats = (metric: VitalsMetric, unit: string) => ([
    {
      label: leftName,
      value: latest.left[metric] ? `${Math.round(latest.left[metric].value)} ${unit}` : '—',
      color: SIDE_COLORS.left,
    },
    {
      label: rightName,
      value: latest.right[metric] ? `${Math.round(latest.right[metric].value)} ${unit}` : '—',
      color: SIDE_COLORS.right,
    },
  ]);

  return (
    <PageContainer sx={ { mb: 15, gap: 2, justifyContent: 'flex-start' } }>
      <Header title="Vitals" icon={ <FavoriteIcon /> }/>

      { /* Lookback window selector */ }
      <Box sx={ { display: 'flex', gap: 1, width: '100%', justifyContent: 'flex-end' } }>
        { WINDOW_OPTIONS.map((option) => (
          <Chip
            key={ option.hours }
            label={ option.label }
            size="small"
            variant={ windowHours === option.hours ? 'filled' : 'outlined' }
            onClick={ () => setWindowHours(option.hours) }
            sx={ {
              color: windowHours === option.hours ? palette.text.primary : palette.text.secondary,
              borderColor: palette.border.medium,
              backgroundColor: windowHours === option.hours ? palette.bg.hover : 'transparent',
            } }
          />
        )) }
      </Box>

      { /* Live per-person snapshot cards, side by side */ }
      <Box sx={ { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, width: '100%' } }>
        <ErrorBoundary componentName={ `${leftName} card` }>
          <PersonCard
            name={ leftName }
            color={ SIDE_COLORS.left }
            presence={ presence?.left }
            heartRate={ latest.left.heart_rate }
            hrv={ latest.left.hrv }
            breathingRate={ latest.left.breathing_rate }
            sideStatus={ deviceStatus?.left }
          />
        </ErrorBoundary>
        <ErrorBoundary componentName={ `${rightName} card` }>
          <PersonCard
            name={ rightName }
            color={ SIDE_COLORS.right }
            presence={ presence?.right }
            heartRate={ latest.right.heart_rate }
            hrv={ latest.right.hrv }
            breathingRate={ latest.right.breathing_rate }
            sideStatus={ deviceStatus?.right }
          />
        </ErrorBoundary>
      </Box>

      { /* Overlay charts: both sides on shared axes, one card per metric */ }
      { METRIC_CHARTS.map(({ metric, title, unit }) => {
        const rows = metricRows[metric] ?? [];
        return (
          <ErrorBoundary key={ metric } componentName={ `${title} chart` }>
            <MetricChartCard title={ title } stats={ sideStats(metric, unit) }>
              { rows.length > 0 ? (
                <OverlayTimeSeriesChart
                  rows={ rows }
                  leftColor={ SIDE_COLORS.left }
                  rightColor={ SIDE_COLORS.right }
                  xValueFormatter={ formatTick }
                />
              ) : (
                <Typography sx={ { fontSize: '0.85rem', color: palette.text.tertiary, px: 2.5, pb: 1 } }>
                  No readings in this window yet.
                </Typography>
              ) }
            </MetricChartCard>
          </ErrorBoundary>
        );
      }) }

      { /* Bed temperature overlay */ }
      <ErrorBoundary componentName="Bed temperature chart">
        <MetricChartCard
          title="BED TEMPERATURE"
          stats={ (['left', 'right'] as const).map((side) => ({
            label: side === 'left' ? leftName : rightName,
            value: deviceStatus?.[side]?.isOn
              ? `${Math.round(deviceStatus[side].currentTemperatureF)} °F`
              : 'Off',
            color: SIDE_COLORS[side],
          })) }
        >
          { temperatureRows.length > 0 ? (
            <OverlayTimeSeriesChart
              rows={ temperatureRows }
              leftColor={ SIDE_COLORS.left }
              rightColor={ SIDE_COLORS.right }
              xValueFormatter={ formatTick }
              yValueFormatter={ (n) => `${Math.round(n)}°` }
            />
          ) : (
            <Typography sx={ { fontSize: '0.85rem', color: palette.text.tertiary, px: 2.5, pb: 1 } }>
              No readings in this window yet.
            </Typography>
          ) }
        </MetricChartCard>
      </ErrorBoundary>
    </PageContainer>
  );
}
