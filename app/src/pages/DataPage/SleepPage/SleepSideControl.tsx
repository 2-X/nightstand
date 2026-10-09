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

export default function SleepSideControl({ selectedDate, timeZone, displayedRecord }: {
  selectedDate: string; timeZone: string; displayedRecord?: SleepRecord;
}) {
  const start = moment.tz(selectedDate, timeZone).startOf('day');
  const range = { startTime: start.toISOString(), endTime: start.clone().add(1, 'day').toISOString() };
  const left = useSleepRecords({ side: 'left', ...range });
  const right = useSleepRecords({ side: 'right', ...range });
  const nightFor = (side: 'left' | 'right', records: SleepRecord[] | undefined) =>
    recordForNight(withoutFutureRecords((records ?? []).filter(record => record.side === side), moment().valueOf()), selectedDate, timeZone);
  const leftCaption = nightCaption(displayedRecord?.side === 'left' ? displayedRecord : nightFor('left', left.data));
  const rightCaption = nightCaption(displayedRecord?.side === 'right' ? displayedRecord : nightFor('right', right.data));
  return <SideControl
    mergeAwaySides={ false }
    captions={ {
      left: displayedRecord?.side === 'left' ? leftCaption
        : left.isError ? 'Recording unavailable' : left.isPending ? 'Loading recording' : leftCaption,
      right: displayedRecord?.side === 'right' ? rightCaption
        : right.isError ? 'Recording unavailable' : right.isPending ? 'Loading recording' : rightCaption,
    } }/>;
}
