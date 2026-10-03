import SectionHeading from '@components/SectionHeading';
import { useState } from 'react';
import moment from 'moment-timezone';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { SleepRecord } from '@api/sleepSchema';
import { useSettings } from '@api/settings';
import { useSleepScore, useSleepScoreEnabled } from '@api/sleepScore';
import GlassCard from '@design/GlassCard';
import { palette, typography } from '@design/tokens';
import {
  formatSleepDuration, SLEEP_GOAL_MIN_SECONDS, SLEEP_GOAL_MAX_SECONDS, SLEEP_RANGE_SOURCE, SLEEP_RANGE_TEXT,
} from '../pages/DataPage/SleepPage/sleepContext';

type Props = { sleepRecord: SleepRecord; timeZone?: string; title?: string; timeZoneLabel?: string };
const CONTRIBUTORS = [
  { key: 'duration', label: 'Duration' },
  { key: 'continuity', label: 'Trips out of bed' },
] as const;

const spaceUnit = (value: string) => value.replace(/\s*(ms|bpm)$/, ' $1');

export default function SleepFitnessCard({ sleepRecord, timeZone, title, timeZoneLabel }: Props) {
  const { data: settings } = useSettings();
  const zone = timeZone ?? settings?.timeZone ?? 'UTC';
  const enabled = useSleepScoreEnabled();
  const query = { side: sleepRecord.side as 'left' | 'right', startTime: sleepRecord.entered_bed_at, endTime: sleepRecord.left_bed_at };
  const { data: score, isPending, isError } = useSleepScore(query, enabled);
  const [infoOpen, setInfoOpen] = useState(false);
  const inBed = sleepRecord.sleep_period_seconds;
  const hasScore = enabled && score?.active && score.score !== null && Number.isFinite(score?.score);
  const shownScore = hasScore ? Math.round(score.score!) : undefined;

  return (
    <GlassCard aria-label="Night summary">
      { title && <SectionHeading sx={ { color: 'text.secondary', mb: 1.5 } }>{ title }</SectionHeading> }
      { timeZoneLabel && <Typography variant="body2" color="text.secondary" sx={ { mb: 1 } }>{ timeZoneLabel }</Typography> }
      <Typography sx={ typography.metricValue }>
        { formatSleepDuration(inBed) }
      </Typography>
      <Typography variant="body2" color="text.secondary">Detected time in bed</Typography>
      { enabled && (
        <Box sx={ { display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1 } }>
          { hasScore
            ? <Typography variant="body2" color="text.secondary">{ `Sleep score ${shownScore} (estimate)` }</Typography>
            : <Typography variant="body2" color="text.secondary">
              { isError ? 'Score unavailable' : isPending ? 'Loading score' : 'Score not available' }
            </Typography> }
          <Typography variant="body2" color="text.secondary">Estimate from bed sensors</Typography>
          <IconButton aria-label="About the sleep estimate" onClick={ () => setInfoOpen(true) } sx={ { minWidth: 44, minHeight: 44 } }>
            <InfoOutlinedIcon fontSize="small"/>
          </IconButton>
        </Box>
      ) }
      <Typography variant="body2" color="text.secondary" sx={ { mt: 0.5 } }>
        <Box component="span">{ moment.tz(sleepRecord.entered_bed_at, zone).format('h:mm A') }</Box>
        { ' to ' }
        <Box component="span">{ moment.tz(sleepRecord.left_bed_at, zone).format('h:mm A') }</Box>
      </Typography>
      { (inBed < SLEEP_GOAL_MIN_SECONDS || inBed > SLEEP_GOAL_MAX_SECONDS) && (
        <Typography variant="body2" color="text.secondary" sx={ { mt: 1 } }>
          { inBed < SLEEP_GOAL_MIN_SECONDS ? 'Under' : 'Over' } the { SLEEP_RANGE_TEXT } range for time in bed
        </Typography>
      ) }
      { enabled && (
        <Box sx={ { display: 'grid', gap: 1.5, mt: 2 } }>
          { CONTRIBUTORS.map(({ key, label }) => {
            const component = score?.components?.[key];
            return (
              <Box key={ key }>
                <Box sx={ { display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.5 } }>
                  <Typography variant="body2">{ label }</Typography>
                  <Typography variant="body2" color="text.secondary">
                    { component?.available ? spaceUnit(component.value)
                      : isError ? 'Unavailable' : isPending ? 'Loading' : 'Not enough data' }
                  </Typography>
                </Box>
                { component?.available && <LinearProgress
                  aria-label={ `${label} contribution` }
                  variant="determinate"
                  value={ Math.max(0, Math.min(100, component.score)) }
                  sx={ {
                    height: 5, borderRadius: 1, bgcolor: palette.border.subtle,
                    '& .MuiLinearProgress-bar': { bgcolor: palette.lamp, transition: 'none' },
                  } }/> }
              </Box>
            );
          }) }
        </Box>
      ) }
      <Dialog open={ infoOpen } onClose={ () => setInfoOpen(false) } aria-labelledby="sleep-estimate-title">
        <DialogTitle id="sleep-estimate-title">About this estimate</DialogTitle>
        <DialogContent>
          <Typography>
            A rough summary of time in bed and trips out of bed from the bed's sensors. It has not been validated and
            is mostly driven by how long you were in bed.
          </Typography>
          { CONTRIBUTORS.map(({ key, label }) => {
            const component = score?.components?.[key];
            return component?.available ? (
              <Typography key={ key } variant="body2" sx={ { mt: 2 } }>
                { label }: { spaceUnit(component.value) }
              </Typography>
            ) : null;
          }) }
          { score?.components?.restingHr?.value && (
            <Typography variant="body2" sx={ { mt: 2 } }>
              { `Lowest heart rate (estimate): ${spaceUnit(score.components.restingHr.value)}` }
            </Typography>
          ) }
          <Typography variant="body2" color="text.secondary" sx={ { mt: 2 } }>
            The duration contribution uses time in bed.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={ { mt: 2 } }>{ SLEEP_RANGE_SOURCE }</Typography>
        </DialogContent>
        <DialogActions><Button onClick={ () => setInfoOpen(false) }>Close</Button></DialogActions>
      </Dialog>
    </GlassCard>
  );
}
