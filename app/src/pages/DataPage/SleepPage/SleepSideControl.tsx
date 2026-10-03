import moment from 'moment-timezone';
import SideControl from '@components/SideControl';
import { useSleepRecords } from '@api/sleep';
import type { SleepRecord } from '@api/sleepSchema';
import { useSleepStages } from '@api/sleepStages';
import { useSleepScoreEnabled } from '@api/sleepScore';
import { formatSleepDuration, nightDuration, recordForNight, withoutFutureRecords } from './sleepContext';

function useNightCaption(record: SleepRecord | undefined, enabled: boolean) {
  const query = { side: record?.side === 'right' ? 'right' as const : 'left' as const,
    startTime: record?.entered_bed_at, endTime: record?.left_bed_at };
  const { data: stages } = useSleepStages(query, enabled && !!record);
  if (!record) return 'No recording';
  const duration = nightDuration(record.sleep_period_seconds, enabled ? stages : undefined);
  return `${formatSleepDuration(duration.seconds)}${duration.kind === 'in bed' ? ' in bed' : ''}`;
}

export default function SleepSideControl({ selectedDate, timeZone }: { selectedDate: string; timeZone: string }) {
  const left = useSleepRecords({ side: 'left' });
  const right = useSleepRecords({ side: 'right' });
  const enabled = useSleepScoreEnabled();
  const nightFor = (side: 'left' | 'right', records: SleepRecord[] | undefined) =>
    recordForNight(withoutFutureRecords((records ?? []).filter(record => record.side === side), moment().valueOf()), selectedDate, timeZone);
  const leftCaption = useNightCaption(nightFor('left', left.isError ? [] : left.data), enabled);
  const rightCaption = useNightCaption(nightFor('right', right.isError ? [] : right.data), enabled);
  return <SideControl
    mergeAwaySides={ false }
    captions={ {
      left: left.isError ? 'Recording unavailable' : left.isPending ? 'Loading recording' : leftCaption,
      right: right.isError ? 'Recording unavailable' : right.isPending ? 'Loading recording' : rightCaption,
    } }/>;
}
