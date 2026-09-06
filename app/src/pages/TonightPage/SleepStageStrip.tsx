import { Box, Tooltip } from '@mui/material';
import moment from 'moment-timezone';
import type { StageEpoch, SleepStage } from '@api/sleepStages.ts';
import { palette } from '@design/tokens';

const STAGE_COLOR: Record<SleepStage, string> = {
  awake: palette.accent.orange,
  rem: palette.accent.purple,
  light: '#4a7fb5',
  deep: '#2b3a67',
};

type Props = {
  epochs: StageEpoch[];
  windowStartMs: number;
  windowEndMs: number;
  timeZone: string;
};

/**
 * A thin horizontal strip under the chart, one colored segment per stage epoch,
 * positioned by time so it lines up with the chart's x axis. Renders nothing
 * when there are no epochs (caller hides gracefully).
 */
export default function SleepStageStrip({ epochs, windowStartMs, windowEndMs, timeZone }: Props) {
  if (!epochs.length) return null;
  const span = windowEndMs - windowStartMs;
  if (span <= 0) return null;

  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - windowStartMs) / span) * 100))}%`;

  return (
    <Box sx={ { width: '100%', px: '38px' } }>
      <Box
        sx={ {
          position: 'relative',
          height: 14,
          borderRadius: 1,
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.03)',
        } }
      >
        { epochs.map((e) => {
          const startMs = e.startUnix * 1000;
          const endMs = e.endUnix * 1000;
          if (endMs <= windowStartMs || startMs >= windowEndMs) return null;
          const left = pct(startMs);
          const right = pct(endMs);
          const label = `${e.stage} ${moment.tz(startMs, timeZone).format('h:mma')}`;
          return (
            <Tooltip key={ e.startUnix } title={ label } arrow>
              <Box
                sx={ {
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left,
                  width: `calc(${right} - ${left})`,
                  backgroundColor: STAGE_COLOR[e.stage],
                  opacity: 0.85,
                } }
              />
            </Tooltip>
          );
        }) }
      </Box>
    </Box>
  );
}
