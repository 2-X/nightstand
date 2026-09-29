import { useMemo } from 'react';
import moment from 'moment-timezone';
import { Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import { useAppStore } from '@state/appStore.tsx';
import { useSleepRecords } from '@api/sleep.ts';
import { useSleepScore, useSleepScoreEnabled } from '@api/sleepScore.ts';

export default function LastNightChip() {
  const { side } = useAppStore();
  const navigate = useNavigate();
  const sleepScoreEnabled = useSleepScoreEnabled();

  // Fetch the most recent sleep record from the last 36 hours. Computed once
  // per mount, not on every render: useSleepRecords keys its query on this
  // params object, so recomputing "now" on every render would generate a
  // new query key (and a new network request) every single render.
  const { startTime, endTime } = useMemo(() => ({
    startTime: moment().subtract(36, 'hours').toISOString(),
    endTime: moment().toISOString(),
  }), []);
  const { data: records } = useSleepRecords({ side, startTime, endTime });
  const last = records?.[records.length - 1];

  const { data: score } = useSleepScore(
    {
      side,
      startTime: last?.entered_bed_at,
      endTime: last?.left_bed_at,
    },
    sleepScoreEnabled && !!last,
  );

  if (!sleepScoreEnabled || !last || !score?.active || score.score === null) return null;

  return (
    <Button
      fullWidth
      onClick={ () => navigate('/sleep') }
      sx={ { justifyContent: 'space-between', gap: 1, px: 2, color: 'text.secondary', bgcolor: 'background.paper' } }>
      <Typography component="span" variant="body2">Last night, estimated score { score.score }</Typography>
      <Typography component="span" variant="body2" sx={ { whiteSpace: 'nowrap' } }>View sleep</Typography>
    </Button>
  );
}
