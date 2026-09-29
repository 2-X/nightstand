import SideControl from '@components/SideControl';
import { useSleepRecords } from '@api/sleep';
import type { SleepRecord } from '@api/sleepSchema';
import { useSleepStages } from '@api/sleepStages';
import { useSleepScore, useSleepScoreEnabled } from '@api/sleepScore';
import { formatSleepDuration, nightDuration, recordForNight } from './sleepContext';

function useNightCaption(record: SleepRecord | undefined, enabled: boolean) {
  const query = { side: record?.side === 'right' ? 'right' as const : 'left' as const,
    startTime: record?.entered_bed_at, endTime: record?.left_bed_at };
  const { data: stages } = useSleepStages(query, enabled && !!record);
  const { data: score } = useSleepScore(query, enabled && !!record);
  if (!record) return 'No recording';
  const duration = nightDuration(record.sleep_period_seconds, enabled ? stages : undefined);
  const estimate = enabled && score?.active && score.score !== null && Number.isFinite(score.score) ? `${score.score}, ` : '';
  return `${estimate}${formatSleepDuration(duration.seconds)}${duration.kind === 'in bed' ? ' in bed' : ''}`;
}

export default function SleepSideControl({ selectedDate, timeZone }: { selectedDate: string; timeZone: string }) {
  const left = useSleepRecords({ side: 'left' });
  const right = useSleepRecords({ side: 'right' });
  const enabled = useSleepScoreEnabled();
  const leftCaption = useNightCaption(recordForNight(left.isError ? [] : left.data ?? [], selectedDate, timeZone), enabled);
  const rightCaption = useNightCaption(recordForNight(right.isError ? [] : right.data ?? [], selectedDate, timeZone), enabled);
  return <SideControl
    mergeAwaySides={ false }
    captions={ {
      left: left.isError ? 'Recording unavailable' : left.isPending ? 'Loading recording' : leftCaption,
      right: right.isError ? 'Recording unavailable' : right.isPending ? 'Loading recording' : rightCaption,
    } }/>;
}
