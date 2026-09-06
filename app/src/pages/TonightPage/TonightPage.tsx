import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Chip, Divider, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import moment from 'moment-timezone';

import PageContainer from '../PageContainer.tsx';
import SideControl from '../../components/SideControl.tsx';
import ErrorBoundary from '@components/ErrorBoundary.tsx';
import TonightChart, { ChartPoint, AlarmMarker } from './TonightChart.tsx';
import SleepStageStrip from './SleepStageStrip.tsx';
import { cadenceLabel } from './cadence.ts';
import { computeProjectedCurve } from './projection.ts';

import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { useSchedules } from '@api/schedules.ts';
import { useDeviceStatus } from '@api/deviceStatus';
import { useTemperatureHistory } from '@api/temperature.ts';
import { useUpcomingAlarms, useRecurringAlarms } from '@api/alarms.ts';
import { useSleepStages } from '@api/sleepStages.ts';
import { palette } from '@design/tokens';

// After a target change the hub water sensor reaches the new setpoint in ~2 min
// but the bed surface lags 10-25 min. Show a "bed catching up" note for this
// long after the last observed target change (Phase 2.5 display honesty).
const BED_CATCHUP_MS = 15 * 60 * 1000;

export default function TonightPage() {
  const navigate = useNavigate();
  const { side } = useAppStore();
  const { data: settings } = useSettings();
  const { data: schedules } = useSchedules();
  const { data: deviceStatus } = useDeviceStatus();
  const timeZone = settings?.timeZone || moment.tz.guess() || 'UTC';

  // Re-render each minute so the "now" cursor and window advance.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data: upcoming } = useUpcomingAlarms(14, undefined);
  const { data: recurring } = useRecurringAlarms();

  // --- Chart window: 2h before tonight's schedule start .. 1h past the last
  // upcoming alarm (fallback to now+9h when there are no alarms).
  const scheduleStartMs = useMemo(() => {
    if (!schedules?.[side]) return nowMs;
    const todayKey = moment.tz(nowMs, timeZone).format('dddd').toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day = (schedules[side] as any)[todayKey];
    const on = day?.power?.on as string | undefined;
    if (!on) return nowMs;
    const [h, m] = on.split(':').map(Number);
    let start = moment.tz(nowMs, timeZone).hour(h).minute(m).second(0).millisecond(0);
    // If power.on is later today it's tonight's start; if it already passed,
    // that was tonight's start too. Only push to yesterday when we're past
    // midnight and before the morning.
    if (start.valueOf() > nowMs + 12 * 3600e3) start = start.subtract(1, 'day');
    return start.valueOf();
  }, [schedules, side, timeZone, nowMs]);

  const sideOccurrences = useMemo(
    () => (upcoming?.occurrences ?? []).filter((o) => o.side === side),
    [upcoming, side],
  );

  const windowStartMs = scheduleStartMs - 2 * 3600e3;
  const lastAlarmMs = sideOccurrences.length
    ? sideOccurrences[sideOccurrences.length - 1].epochMs
    : nowMs + 8 * 3600e3;
  const windowEndMs = Math.max(nowMs + 3600e3, lastAlarmMs + 3600e3);

  // --- Actual water-temp series from the collector history.
  const { data: history } = useTemperatureHistory({
    side,
    startTime: new Date(windowStartMs).toISOString(),
    endTime: new Date(windowEndMs).toISOString(),
  });

  // Live-append the current device-status reading so the actual line reaches
  // "now" between 1-minute history refetches.
  const actual: ChartPoint[] = useMemo(() => {
    const pts: ChartPoint[] = (history ?? [])
      .filter((r) => typeof r.current_temp_f === 'number')
      .map((r) => ({ ts: r.timestamp * 1000, value: r.current_temp_f as number }));
    const liveTemp = deviceStatus?.[side]?.currentTemperatureF;
    if (typeof liveTemp === 'number' && deviceStatus?.[side]?.isOn) {
      // Only append if newer than the last history point.
      const lastTs = pts.length ? pts[pts.length - 1].ts : 0;
      if (nowMs > lastTs) pts.push({ ts: nowMs, value: liveTemp });
    }
    return pts;
  }, [history, deviceStatus, side, nowMs]);

  // --- Projected schedule curve from "now" to window end.
  const projected: ChartPoint[] = useMemo(
    () => computeProjectedCurve(schedules, side, timeZone, nowMs, windowEndMs)
      .map((p) => ({ ts: p.ts, value: p.targetF })),
    [schedules, side, timeZone, nowMs, windowEndMs],
  );

  // --- Alarm markers within the window.
  const alarmMarkers: AlarmMarker[] = useMemo(
    () => sideOccurrences
      .filter((o) => o.epochMs >= windowStartMs && o.epochMs <= windowEndMs)
      .map((o) => ({ ts: o.epochMs, label: moment.tz(o.epochMs, timeZone).format('h:mma') })),
    [sideOccurrences, windowStartMs, windowEndMs, timeZone],
  );

  // --- Sleep-stage strip: only when tonight's data exists.
  const { data: stages } = useSleepStages({
    side,
    startTime: new Date(windowStartMs).toISOString(),
    endTime: new Date(nowMs).toISOString(),
  });
  const stageEpochs = stages?.active ? stages.epochs : [];

  // --- Phase 2.5 "bed catching up" annotation: fired when the target changed
  // recently (last history target_temp_f change within BED_CATCHUP_MS).
  const bedCatchingUp = useMemo(() => {
    const rows = (history ?? []).filter((r) => typeof r.target_temp_f === 'number');
    if (rows.length < 2) return false;
    let lastChangeTs = 0;
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].target_temp_f !== rows[i - 1].target_temp_f) lastChangeTs = rows[i].timestamp * 1000;
    }
    return lastChangeTs > 0 && nowMs - lastChangeTs < BED_CATCHUP_MS;
  }, [history, nowMs]);

  const sideAlarms = (recurring?.[side] ?? []).filter((a) => a.enabled);

  return (
    <PageContainer sx={ { maxWidth: '640px', justifyContent: 'flex-start' } }>
      <Box sx={ { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', width: '100%', px: 0.5, mt: 1 } }>
        <Typography sx={ { fontSize: '2rem', fontWeight: 600, letterSpacing: '-0.02em', color: palette.text.primary } }>
          Tonight
        </Typography>
        <Typography sx={ { fontSize: '0.9rem', color: palette.text.tertiary } }>
          { moment.tz(nowMs, timeZone).format('ddd, MMM D') }
        </Typography>
      </Box>

      <ErrorBoundary componentName='Tonight chart'>
        <TonightChart
          actual={ actual }
          projected={ projected }
          nowMs={ nowMs }
          windowStartMs={ windowStartMs }
          windowEndMs={ windowEndMs }
          alarms={ alarmMarkers }
          timeZone={ timeZone }
        />
      </ErrorBoundary>

      <Box sx={ { width: '100%', display: 'flex', alignItems: 'center', gap: 1, px: '38px', minHeight: 20 } }>
        <Box sx={ { width: 10, height: 2, backgroundColor: '#5DCAA5' } } />
        <Typography sx={ { fontSize: '0.72rem', color: palette.text.tertiary } }>water temp</Typography>
        { bedCatchingUp && (
          <Typography sx={ { fontSize: '0.72rem', color: palette.accent.orange, ml: 1 } }>
            bed catching up…
          </Typography>
        ) }
      </Box>

      <ErrorBoundary componentName='Sleep stage strip'>
        <SleepStageStrip
          epochs={ stageEpochs }
          windowStartMs={ windowStartMs }
          windowEndMs={ windowEndMs }
          timeZone={ timeZone }
        />
      </ErrorBoundary>

      <Divider sx={ { width: '100%', borderColor: palette.border.subtle, my: 1 } } />

      { /* Alarm list with cadence chips */ }
      <Box sx={ { width: '100%', px: 0.5 } }>
        <Box sx={ { display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 } }>
          <Typography sx={ { fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: palette.text.tertiary } }>
            Alarms
          </Typography>
          <Button size="small" onClick={ () => navigate('/alarms') } sx={ { color: palette.text.secondary, minWidth: 0 } }>
            Edit
          </Button>
        </Box>
        { sideAlarms.length === 0 ? (
          <Typography sx={ { fontSize: '0.9rem', color: palette.text.tertiary } }>
            No alarms set for this side.
          </Typography>
        ) : (
          sideAlarms.map((a) => (
            <Box key={ a.id } sx={ { display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1, borderTop: `1px solid ${palette.border.subtle}` } }>
              <Typography sx={ { fontSize: '1.4rem', fontWeight: 500, color: palette.text.primary, fontVariantNumeric: 'tabular-nums' } }>
                { moment(a.time, 'HH:mm').format('h:mm A') }
              </Typography>
              <Chip
                label={ cadenceLabel(a.recurrence) }
                size="small"
                sx={ { color: palette.text.secondary, borderColor: palette.border.medium, backgroundColor: 'transparent' } }
                variant="outlined"
              />
            </Box>
          ))
        ) }
      </Box>

      <SideControl showTemp={ true } />
    </PageContainer>
  );
}
