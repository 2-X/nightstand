import { useMemo } from 'react';
import moment from 'moment-timezone';
import { Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import { useAppStore } from '@state/appStore.tsx';
import { useSleepRecords } from '@api/sleep.ts';
import { useSleepScore, useSleepScoreEnabled } from '@api/sleepScore.ts';
import { useSettings } from '@api/settings.ts';
import { recordForNight } from '../DataPage/SleepPage/sleepContext.ts';

export default function LastNightChip() {
  const { side } = useAppStore();
  const navigate = useNavigate();
  const sleepScoreEnabled = useSleepScoreEnabled();
  const { data: settings } = useSettings();
  // Unset means UTC, as on the Sleep page; wait only while settings load.
  const timeZone = settings ? settings.timeZone ?? 'UTC' : undefined;

  // Fetch the most recent sleep record from the last 36 hours. Computed once
  // per mount, not on every render: useSleepRecords keys its query on this
  // params object, so recomputing "now" on every render would generate a
  // new query key (and a new network request) every single render.
  const { startTime, endTime } = useMemo(() => ({
    startTime: moment().subtract(36, 'hours').toISOString(),
    endTime: moment().toISOString(),
  }), []);
  const { data: records } = useSleepRecords({ side, startTime, endTime });
  // Same pick as the Sleep page: the longest record of the newest wake date.
  const last = useMemo(() => {
    if (!timeZone) return undefined;
    const sideRecords = records?.filter(record => record.side === side) ?? [];
    const newest = [...sideRecords].sort((a, b) => Date.parse(b.left_bed_at) - Date.parse(a.left_bed_at))[0];
    return newest && recordForNight(sideRecords, moment.tz(newest.left_bed_at, timeZone).format('YYYY-MM-DD'), timeZone);
  }, [records, side, timeZone]);

  const { data: score } = useSleepScore(
    {
      side,
      startTime: last?.entered_bed_at,
      endTime: last?.left_bed_at,
    },
    sleepScoreEnabled && !!last,
  );

  if (!sleepScoreEnabled || !last || !score?.active || !Number.isFinite(score.score) || score.score === null) return null;

  return (
    <Button
      fullWidth
      onClick={ () => navigate('/sleep') }
      sx={ { justifyContent: 'space-between', gap: 1, px: 1.5, color: 'text.secondary', bgcolor: 'background.paper' } }>
      <Typography component="span" variant="body2" sx={ { whiteSpace: 'nowrap' } }>Last night estimate { score.score }</Typography>
      <Typography component="span" variant="body2" sx={ { whiteSpace: 'nowrap' } }>View sleep</Typography>
    </Button>
  );
}
