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
import { palette, radius, typography } from '@design/tokens';

type Props = {
  startTime: string;
  endTime: string;
  timeZone?: string;
};

type ShownStage = 'awake' | 'asleep';
// Deep, light and REM come from fixed rules and are not shown apart.
const shown = (stage: SleepStage): ShownStage => (stage === 'awake' ? 'awake' : 'asleep');
// Y-axis position for each row (0 = top, 1 = bottom)
const SHOWN_Y: Record<ShownStage, number> = { awake: 0.25, asleep: 0.7 };
const SHOWN_LABEL: Record<ShownStage, string> = { awake: 'Awake', asleep: 'Asleep' };
const SHOWN_COLOR: Record<ShownStage, string> = { awake: palette.stage.awake, asleep: palette.stage.light };

type ShownEpoch = { startUnix: number; endUnix: number; stage: ShownStage };
// The look's mark corner, no rounder than a bar's own half width or height.
const markCorner = (width: number, height: number) => Math.min(radius.mark, width / 2, height / 2);

// Merge consecutive epochs of the same row into a single segment so we
// don't render hundreds of overlapping blocks.
function mergeAdjacent(epochs: StageEpoch[]): ShownEpoch[] {
  if (epochs.length === 0) return [];
  const mapped: ShownEpoch[] = epochs.map(epoch => ({ ...epoch, stage: shown(epoch.stage) }));
  const out: ShownEpoch[] = [{ ...mapped[0] }];
  for (let i = 1; i < mapped.length; i++) {
    const prev = out[out.length - 1];
    const cur = mapped[i];
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
  const yOf = (stage: ShownStage) => SHOWN_Y[stage] * VB_H;

  const merged = mergeAdjacent(epochs);

  return (
    <Box sx={ { width: '100%', mb: 1, touchAction: 'pan-y', display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)' } }>
      <Box sx={ { position: 'relative', height: 140 } }>
        { (Object.keys(SHOWN_Y) as ShownStage[]).map(stage => (
          <Typography
            key={ stage }
            sx={ {
              position: 'absolute', top: `${SHOWN_Y[stage] * 100}%`, transform: 'translateY(-50%)',
              fontSize: 12, color: palette.text.secondary,
            } }>{ SHOWN_LABEL[stage] }</Typography>
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
              stroke={ SHOWN_COLOR[seg.stage] }
              strokeWidth={ 1.5 }
              strokeOpacity={ 0.55 }
            />
          );
        }) }

        { /* Stage segments - Awake renders as a tall thin bar reaching the top edge */ }
        { merged.map((seg, i) => {
          const x = xOf(seg.startUnix);
          const w = Math.max(2, xOf(seg.endUnix) - xOf(seg.startUnix));
          const color = SHOWN_COLOR[seg.stage];
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
                rx={ markCorner(w, bottom - top) }
                ry={ markCorner(w, bottom - top) }
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
              rx={ markCorner(w, SEGMENT_THICKNESS) }
              ry={ markCorner(w, SEGMENT_THICKNESS) }
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
      <SectionHeading sx={ { mb: 0.5 } }>Estimated sleep and wake</SectionHeading>
      <Typography variant="body2" color="text.secondary" sx={ { mb: 1.5 } }>
        From heart rate and movement. Not compared with a sleep study.
      </Typography>
      { isError && (
        <Alert severity="error" action={ <Button onClick={ () => refetch() }>Retry</Button> }>Sleep stages could not be loaded.</Alert>
      ) }
      { isPending && !isError && <CircularProgress sx={ { display: 'block', mx: 'auto', my: 4 } } /> }

      { !isError && data && data.epochs.length > 0 && (
        <>
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
