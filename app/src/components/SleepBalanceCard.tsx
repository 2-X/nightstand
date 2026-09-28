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
  const average = nights ? total / nights : 0;
  const belowRange = average < 6.5 * 3600;
  const aboveRange = average > 9 * 3600;
  return (
    <GlassCard label="Sleep balance">
      <Typography>{ nights } of 7 nights recorded</Typography>
      { nights > 0 && (
        <>
          <Typography sx={ { fontSize: '1.5rem', my: 1 } }>
            { formatSleepDuration(total / nights) } average
          </Typography>
          <Typography variant="body2">
            { belowRange ? `${formatSleepDuration(6.5 * 3600 - average)} below`
              : aboveRange ? `${formatSleepDuration(average - 9 * 3600)} above` : 'Within' } your 6.5 to 9 hour range per recorded night.
          </Typography>
        </>
      ) }
      <Typography variant="body2" color="text.secondary" sx={ { mt: 1 } }>
        { nights < 7 ? 'Incomplete coverage. Missing nights are not counted as zero sleep.' : 'Full recorded-night coverage for this week.' }
      </Typography>
    </GlassCard>
  );
}
