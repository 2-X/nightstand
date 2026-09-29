import { useQueries } from '@tanstack/react-query';
import type { SleepRecord } from '@api/sleepSchema';
import { sleepStagesQueryOptions } from '@api/sleepStages';
import { useSleepScoreEnabled } from '@api/sleepScore';
import { nightDuration } from './sleepContext';

export default function useNightDurations(records: SleepRecord[]) {
  const enabled = useSleepScoreEnabled();
  const stages = useQueries({ queries: records.map(record => sleepStagesQueryOptions({
    side: record.side as 'left' | 'right', startTime: record.entered_bed_at, endTime: record.left_bed_at,
  }, enabled)) });
  return {
    durations: records.map((record, index) => nightDuration(record.sleep_period_seconds, enabled ? stages[index].data : undefined)),
    isPending: enabled && stages.some(query => query.isPending),
  };
}
