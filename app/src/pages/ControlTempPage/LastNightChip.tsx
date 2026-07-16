import { useMemo } from 'react';
import moment from 'moment-timezone';
import { Chip, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import BedIcon from '@mui/icons-material/Bed';

import { useAppStore } from '@state/appStore.tsx';
import { useSleepRecords } from '@api/sleep.ts';
import { useSleepScore, useSleepScoreEnabled } from '@api/sleepScore.ts';

function scoreColor(score: number): string {
  if (score >= 85) return '#22c55e';
  if (score >= 70) return '#84cc16';
  if (score >= 55) return '#eab308';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

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
    <Box display="flex" justifyContent="center" sx={ { width: '100%' } }>
      <Chip
        icon={ <BedIcon sx={ { color: `${scoreColor(score.score)} !important`, fontSize: 18 } }/> }
        label={ `Last night · ${score.score}` }
        clickable
        onClick={ () => navigate('/data/sleep') }
        sx={ {
          backgroundColor: 'rgba(255,255,255,0.04)',
          border: `1px solid ${scoreColor(score.score)}40`,
          color: scoreColor(score.score),
          fontWeight: 600,
          '& .MuiChip-icon': { color: scoreColor(score.score) },
        } }
      />
    </Box>
  );
}
