import moment from 'moment-timezone';
import { Typography } from '@mui/material';
import type { SleepRecord } from '@api/sleepSchema';
import GlassCard from '@design/GlassCard';
import { formatSleepDuration, recordsInWeek } from '../pages/DataPage/SleepPage/sleepContext';

type Props = { records: SleepRecord[]; weekStart: moment.Moment; timeZone: string };

export default function SleepBalanceCard({ records, weekStart, timeZone }: Props) {
  const recorded = recordsInWeek(records, weekStart, timeZone);
  const nights = new Set(recorded.map(record => moment.tz(record.left_bed_at, timeZone).format('YYYY-MM-DD'))).size;
  const total = recorded.reduce((seconds, record) => seconds + record.sleep_period_seconds, 0);
  const balance = total - nights * 8 * 3600;
  return (
    <GlassCard label="Sleep balance">
      <Typography>{ nights } of 7 nights recorded</Typography>
      { nights > 0 && (
        <>
          <Typography sx={ { fontSize: '1.5rem', my: 1 } }>
            { formatSleepDuration(total / nights) } average
          </Typography>
          <Typography variant="body2">
            { formatSleepDuration(Math.abs(balance / nights)) } { balance >= 0 ? 'above' : 'below' } an 8-hour reference per recorded night.
          </Typography>
        </>
      ) }
      <Typography variant="body2" color="text.secondary" sx={ { mt: 1 } }>
        { nights < 7 ? 'Incomplete coverage. Missing nights are not counted as zero sleep.' : 'Full recorded-night coverage for this week.' }
      </Typography>
    </GlassCard>
  );
}
