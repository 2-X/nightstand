// The helper components below are private to this file and used only by its
// default export, so they stay next to their only consumer.
/* eslint-disable react/no-multi-comp */
import SectionHeading from '@components/SectionHeading';
import moment from 'moment-timezone';
import { Alert, Box, Button, Typography } from '@mui/material';
import CircularProgress from '@mui/material/CircularProgress';

import { useAppStore } from '@state/appStore.tsx';
import { useSleepStages, SleepStage, StageEpoch } from '@api/sleepStages.ts';
import { useSleepScoreEnabled } from '@api/sleepScore.ts';
import GlassCard from '@design/GlassCard';
import { palette, typography } from '@design/tokens';
import { formatSleepDuration } from '../pages/DataPage/SleepPage/sleepContext';

type Props = {
  startTime: string;
  endTime: string;
  timeZone?: string;
};

const STAGE_COLOR: Record<SleepStage, string> = palette.stage;
// Y-axis position for each stage (0 = top, 1 = bottom)
const STAGE_Y: Record<SleepStage, number> = {
  awake: 0.10,
  rem:   0.34,
  light: 0.58,
  deep:  0.82,
};
const STAGE_LABEL: Record<SleepStage, string> = {
  awake: 'Awake',
  rem:   'REM',
  light: 'Light',
  deep:  'Deep',
};

// Merge consecutive epochs of the same stage into a single segment so we
// don't render hundreds of overlapping blocks. e.g. ten 5-min Light epochs
// in a row → one 50-min Light segment.
function mergeAdjacent(epochs: StageEpoch[]): StageEpoch[] {
  if (epochs.length === 0) return [];
  const out: StageEpoch[] = [{ ...epochs[0] }];
  for (let i = 1; i < epochs.length; i++) {
    const prev = out[out.length - 1];
    const cur = epochs[i];
    // Treat a tiny gap (≤ 60s) as continuous - sometimes vitals records
    // arrive at slightly off-boundary timestamps.
    if (cur.stage === prev.stage && cur.startUnix - prev.endUnix <= 60) {
      prev.endUnix = cur.endUnix;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function StatBlock({
  label,
  duration,
  pct,
}: {
  label: string;
  duration: string;
  pct: string;
}) {
  return (
    <Box sx={ { minWidth: 0 } }>
      <Typography
        sx={ {
          fontSize: '0.875rem',
          color: palette.text.secondary,
          fontWeight: 400,
          mb: 0.5,
        } }
      >
        { label }
      </Typography>
      <Box sx={ { display: 'flex', alignItems: 'baseline', gap: 1 } }>
        <Typography
          sx={ {
            fontSize: '1.5rem',
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: palette.text.primary,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.05,
            whiteSpace: 'nowrap',
          } }
        >
          { duration }
        </Typography>
        <Typography
          component="span"
          sx={ {
            fontSize: '0.875rem',
            color: palette.text.primary,
            opacity: 0.85,
            fontWeight: 400,
            borderLeft: `1px solid ${palette.border.subtle}`,
            pl: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            whiteSpace: 'nowrap',
          } }
        >
          { pct }
        </Typography>
      </Box>
    </Box>
  );
}

// SVG-based step chart. Each segment is a thick rounded horizontal line at
// its stage's Y; transitions between stages render as thin vertical lines
// connecting the previous segment's right edge to the next segment's left
// edge, giving the chart a "step waveform" look.
function StagesChart({ epochs, periodStart, periodEnd }: {
  epochs: StageEpoch[];
  periodStart: number;
  periodEnd: number;
}) {
  const VB_W = 1000;
  const VB_H = 200;
  const SEGMENT_THICKNESS = 14;
  const span = Math.max(1, periodEnd - periodStart);

  const xOf = (t: number) => ((t - periodStart) / span) * VB_W;
  const yOf = (stage: SleepStage) => STAGE_Y[stage] * VB_H;

  const merged = mergeAdjacent(epochs);

  return (
    <Box sx={ { width: '100%', mb: 1, touchAction: 'pan-y', display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)' } }>
      <Box sx={ { position: 'relative', height: 140 } }>
        { (Object.keys(STAGE_Y) as SleepStage[]).map(stage => (
          <Typography
            key={ stage }
            sx={ {
              position: 'absolute', top: `${STAGE_Y[stage] * 100}%`, transform: 'translateY(-50%)',
              fontSize: 12, color: palette.text.secondary,
            } }>{ STAGE_LABEL[stage] }</Typography>
        )) }
      </Box>
      <svg
        viewBox={ `0 0 ${VB_W} ${VB_H}` }
        preserveAspectRatio="none"
        style={ { display: 'block', width: '100%', height: 140, touchAction: 'pan-y' } }
      >
        { /* Connecting vertical lines between adjacent segments of different stages */ }
        { merged.map((seg, i) => {
          if (i === 0) return null;
          const prev = merged[i - 1];
          if (prev.stage === seg.stage) return null;
          const x = xOf(seg.startUnix);
          const y1 = yOf(prev.stage);
          const y2 = yOf(seg.stage);
          // Use the destination stage's color for the connector (gives the
          // visual sense of "moving into" the new stage).
          return (
            <line
              key={ `c-${i}` }
              x1={ x }
              y1={ y1 }
              x2={ x }
              y2={ y2 }
              stroke={ STAGE_COLOR[seg.stage] }
              strokeWidth={ 1.5 }
              strokeOpacity={ 0.55 }
            />
          );
        }) }

        { /* Stage segments - Awake renders as a tall thin bar reaching the top edge */ }
        { merged.map((seg, i) => {
          const x = xOf(seg.startUnix);
          const w = Math.max(2, xOf(seg.endUnix) - xOf(seg.startUnix));
          const color = STAGE_COLOR[seg.stage];
          if (seg.stage === 'awake') {
            // From the top of the chart down to the awake row.
            const top = 0;
            const bottom = yOf('awake') + SEGMENT_THICKNESS / 2;
            return (
              <rect
                key={ i }
                x={ x }
                y={ top }
                width={ w }
                height={ bottom - top }
                fill={ color }
                opacity={ 0.85 }
                rx={ 1.5 }
                ry={ 1.5 }
              />
            );
          }
          const y = yOf(seg.stage) - SEGMENT_THICKNESS / 2;
          return (
            <rect
              key={ i }
              x={ x }
              y={ y }
              width={ w }
              height={ SEGMENT_THICKNESS }
              fill={ color }
              rx={ 4 }
              ry={ 4 }
            />
          );
        }) }
      </svg>
    </Box>
  );
}

export default function SleepStagesCard({ startTime, endTime, timeZone }: Props) {
  const { side } = useAppStore();
  const sleepScoreEnabled = useSleepScoreEnabled();
  const { data, isPending, isError, refetch } = useSleepStages({ side, startTime, endTime }, sleepScoreEnabled);

  const periodStart = moment(startTime).unix();
  const periodEnd = moment(endTime).unix();

  if (!sleepScoreEnabled) return null;
  const firstHour = (timeZone ? moment.tz(startTime, timeZone) : moment(startTime)).startOf('hour');
  if (firstHour.unix() < periodStart) firstHour.add(1, 'hour');
  const stepHours = Math.max(1, Math.ceil((periodEnd - periodStart) / 3600 / 3));
  const ticks: number[] = [];
  for (const tick = firstHour.clone(); tick.unix() <= periodEnd; tick.add(stepHours, 'hours')) ticks.push(tick.unix());

  return (
    <GlassCard>
      <SectionHeading sx={ { mb: 1.5 } }>Sleep stages</SectionHeading>
      { isError && (
        <Alert severity="error" action={ <Button onClick={ () => refetch() }>Retry</Button> }>Sleep stages could not be loaded.</Alert>
      ) }
      { isPending && !isError && <CircularProgress sx={ { display: 'block', mx: 'auto', my: 4 } } /> }

      { !isError && data && data.epochs.length > 0 && (
        <>
          { data.lowCoverage ? (
            <Typography variant="body2" color="text.secondary" sx={ { mb: 2 } }>
              Too few heart readings to total deep sleep and REM for this night.
            </Typography>
          ) : (
            <Box sx={ { display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' } }>
              <StatBlock
                label="Deep sleep"
                duration={ formatSleepDuration(data.totals.deep) }
                pct={ `${data.percentages.deep}%` }
              />
              <StatBlock
                label="REM"
                duration={ formatSleepDuration(data.totals.rem) }
                pct={ `${data.percentages.rem}%` }
              />
            </Box>
          ) }

          <StagesChart
            epochs={ data.epochs }
            periodStart={ periodStart }
            periodEnd={ periodEnd }
          />

          <Box sx={ { position: 'relative', height: 20, ml: '44px' } }>
            { ticks.map(tick => {
              const fraction = (tick - periodStart) / (periodEnd - periodStart);
              // Labels near either end anchor to it so they stay inside the card.
              const shift = fraction < 0.1 ? '0' : fraction > 0.9 ? '-100%' : '-50%';
              return (
                <Typography
                  key={ tick }
                  sx={ {
                    position: 'absolute', left: `${fraction * 100}%`,
                    transform: `translateX(${shift})`, fontSize: 12, color: palette.text.tertiary,
                    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                  } }>
                  { (timeZone ? moment.unix(tick).tz(timeZone) : moment.unix(tick)).format('h:mm A') }
                </Typography>
              );
            }) }
          </Box>
        </>
      ) }

      { !isPending && !isError && (!data || data.epochs.length === 0) && (
        <Typography sx={ { ...typography.caption, color: palette.text.tertiary, textAlign: 'center', py: 4 } }>
          No sleep stages data available for this period
        </Typography>
      ) }
    </GlassCard>
  );
}
