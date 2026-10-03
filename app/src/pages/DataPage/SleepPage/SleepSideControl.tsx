import moment from 'moment-timezone';
import SideControl from '@components/SideControl';
import { useSleepRecords } from '@api/sleep';
import type { SleepRecord } from '@api/sleepSchema';
import { formatSleepDuration, nightDuration, recordForNight, withoutFutureRecords } from './sleepContext';

function nightCaption(record: SleepRecord | undefined) {
  if (!record) return 'No recording';
  const duration = nightDuration(record.sleep_period_seconds);
  return `${formatSleepDuration(duration.seconds)} ${duration.kind}`;
}

export default function SleepSideControl({ selectedDate, timeZone }: { selectedDate: string; timeZone: string }) {
  const left = useSleepRecords({ side: 'left' });
  const right = useSleepRecords({ side: 'right' });
  const nightFor = (side: 'left' | 'right', records: SleepRecord[] | undefined) =>
    recordForNight(withoutFutureRecords((records ?? []).filter(record => record.side === side), moment().valueOf()), selectedDate, timeZone);
  const leftCaption = nightCaption(nightFor('left', left.isError ? [] : left.data));
  const rightCaption = nightCaption(nightFor('right', right.isError ? [] : right.data));
  return <SideControl
    mergeAwaySides={ false }
    captions={ {
      left: left.isError ? 'Recording unavailable' : left.isPending ? 'Loading recording' : leftCaption,
      right: right.isError ? 'Recording unavailable' : right.isPending ? 'Loading recording' : rightCaption,
    } }/>;
}
