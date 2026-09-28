import { useState } from 'react';
import moment from 'moment-timezone';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { SleepRecord } from '@api/sleepSchema';
import { useSettings } from '@api/settings';
import { useSleepScore, useSleepScoreEnabled } from '@api/sleepScore';
import { useSleepStages } from '@api/sleepStages';
import GlassCard from '@design/GlassCard';
import { palette } from '@design/tokens';
import { formatSleepDuration } from '../pages/DataPage/SleepPage/sleepContext';

type Props = { sleepRecord: SleepRecord; timeZone?: string };
const CONTRIBUTORS = [
  { key: 'duration', label: 'Duration' },
  { key: 'continuity', label: 'Continuity' },
  { key: 'hrv', label: 'HRV (filtered)' },
  { key: 'restingHr', label: 'Resting HR' },
] as const;

export default function SleepFitnessCard({ sleepRecord, timeZone }: Props) {
  const { data: settings } = useSettings();
  const zone = timeZone ?? settings?.timeZone ?? 'UTC';
  const enabled = useSleepScoreEnabled();
  const query = { side: sleepRecord.side as 'left' | 'right', startTime: sleepRecord.entered_bed_at, endTime: sleepRecord.left_bed_at };
  const { data: score, isPending, isError } = useSleepScore(query, enabled);
  const { data: stages } = useSleepStages(query, enabled);
  const [infoOpen, setInfoOpen] = useState(false);
  const classified = enabled && stages?.active && stages.epochs.length > 0;
  const asleep = classified ? stages.totals.light + stages.totals.rem + stages.totals.deep : undefined;
  const hasScore = enabled && score?.active && score.score !== null && Number.isFinite(score?.score);
  const band = hasScore ? score.score! >= 85 ? 'Good night' : score.score! >= 70 ? 'Fair night' : 'Rough night' : undefined;

  return (
    <GlassCard aria-label="Night summary">
      { enabled && (
        <>
          { hasScore ? (
            <Box sx={ { display: 'flex', gap: 2, alignItems: 'baseline' } }>
              <Typography
                sx={ {
                  fontSize: '3.5rem', fontWeight: 500, lineHeight: 1.1, color: palette.lamp, fontVariantNumeric: 'tabular-nums',
                } }>
                { score.score }
              </Typography>
              <Typography>{ band }</Typography>
            </Box>
          ) : <Typography>{ isError ? 'Score unavailable' : isPending ? 'Loading score' : 'Score not available' }</Typography> }
          <Box sx={ { display: 'flex', alignItems: 'center', mb: 1 } }>
            <Typography variant="body2" color="text.secondary">Estimate from bed sensors</Typography>
            <IconButton aria-label="About the sleep estimate" onClick={ () => setInfoOpen(true) } sx={ { minWidth: 44, minHeight: 44 } }>
              <InfoOutlinedIcon fontSize="small"/>
            </IconButton>
          </Box>
        </>
      ) }
      <Typography sx={ { fontSize: enabled ? '1.5rem' : '2rem', fontWeight: 500 } }>
        { asleep !== undefined ? `${formatSleepDuration(asleep)} asleep` : formatSleepDuration(sleepRecord.sleep_period_seconds) }
      </Typography>
      { asleep === undefined && <Typography variant="body2" color="text.secondary">Detected time in bed</Typography> }
      { asleep === 0 && <Typography>No sleep detected</Typography> }
      <Typography variant="body2" color="text.secondary" sx={ { mt: 0.5 } }>
        <Box component="span">{ moment.tz(sleepRecord.entered_bed_at, zone).format('h:mm A') }</Box>
        { ' to ' }
        <Box component="span">{ moment.tz(sleepRecord.left_bed_at, zone).format('h:mm A') }</Box>
        { asleep !== undefined && `, ${formatSleepDuration(sleepRecord.sleep_period_seconds)} in bed` }
      </Typography>
      { enabled && (
        <Box sx={ { display: 'grid', gap: 1.5, mt: 2.5 } }>
          { CONTRIBUTORS.map(({ key, label }) => {
            const component = score?.components?.[key];
            return (
              <Box key={ key }>
                <Box sx={ { display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.5 } }>
                  <Typography variant="body2">{ label }</Typography>
                  <Typography variant="body2" color="text.secondary">
                    { component?.available ? key === 'duration' ? formatSleepDuration(sleepRecord.sleep_period_seconds)
                      : key === 'hrv' ? component.value.replace(/\s*ms$/, ' ms')
                        : key === 'restingHr' ? component.value.replace(/\s*bpm$/, ' bpm') : component.value : 'Not enough data' }
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
          <Typography variant="caption" color="text.secondary">
            Score uses HRV readings from 30 to 120 ms. Night measurements use all valid readings.
          </Typography>
        </Box>
      ) }
      <Dialog open={ infoOpen } onClose={ () => setInfoOpen(false) } aria-labelledby="sleep-estimate-title">
        <DialogTitle id="sleep-estimate-title">About this estimate</DialogTitle>
        <DialogContent>
          <Typography>
            Estimated from movement and heart signals picked up by the bed. The score has not been validated
            and is not a medical measurement. Use it to compare your own nights.
          </Typography>
        </DialogContent>
        <DialogActions><Button onClick={ () => setInfoOpen(false) }>Close</Button></DialogActions>
      </Dialog>
    </GlassCard>
  );
}
