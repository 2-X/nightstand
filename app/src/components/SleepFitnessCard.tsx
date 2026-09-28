import moment from 'moment-timezone';
import { Box, Typography } from '@mui/material';
import type { SleepRecord } from '@api/sleepSchema';
import { useAppStore } from '@state/appStore';
import { useSettings } from '@api/settings';
import { useSleepScore, useSleepScoreEnabled } from '@api/sleepScore';
import GlassCard from '@design/GlassCard';
import { formatSleepDuration } from '../pages/DataPage/SleepPage/sleepContext';

type Props = { sleepRecord: SleepRecord; timeZone?: string };

export default function SleepFitnessCard({ sleepRecord, timeZone }: Props) {
  const { side } = useAppStore();
  const { data: settings } = useSettings();
  const zone = timeZone ?? settings?.timeZone ?? 'UTC';
  const enabled = useSleepScoreEnabled();
  const { data: score, isPending, isError } = useSleepScore({
    side, startTime: sleepRecord.entered_bed_at, endTime: sleepRecord.left_bed_at,
  }, enabled);

  return (
    <GlassCard aria-label="Night summary">
      <Typography variant="body2" color="text.secondary">Detected time in bed</Typography>
      <Typography sx={ { fontSize: '2.5rem', fontWeight: 500, my: 0.5 } }>
        { formatSleepDuration(sleepRecord.sleep_period_seconds) }
      </Typography>
      <Box sx={ { display: 'flex', flexWrap: 'wrap', gap: 3, mb: 2 } }>
        <Box>
          <Typography variant="body2" color="text.secondary">In bed</Typography>
          <Typography>{ moment.tz(sleepRecord.entered_bed_at, zone).format('h:mm A') }</Typography>
        </Box>
        <Box>
          <Typography variant="body2" color="text.secondary">Out of bed</Typography>
          <Typography>{ moment.tz(sleepRecord.left_bed_at, zone).format('h:mm A') }</Typography>
        </Box>
      </Box>
      { enabled && (
        <Typography variant="body2">
          Estimated score: { isError ? 'unavailable' : isPending ? 'loading'
            : score?.active && score.score !== null ? `${score.score}/100` : 'not available' }
        </Typography>
      ) }
      <Typography variant="body2" color="text.secondary" sx={ { mt: 0.5 } }>
        Sensor-based estimates may be inaccurate. Recorded duration describes detected presence, not a clinical sleep measurement.
      </Typography>
    </GlassCard>
  );
}
