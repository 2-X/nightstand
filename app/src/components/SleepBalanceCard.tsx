import moment from 'moment-timezone';
import { Box, Typography } from '@mui/material';
import type { SleepRecord } from '@api/sleepSchema';
import GlassCard from '@design/GlassCard';
import { typography } from '@design/tokens';
import {
  formatSleepDuration, nightDuration, recordForNight, summarizeDurations, SLEEP_GOAL_MIN_SECONDS, SLEEP_GOAL_MAX_SECONDS, SLEEP_RANGE_TEXT,
} from '../pages/DataPage/SleepPage/sleepContext';
import WeeklyScheduleBars from '../pages/DataPage/SleepPage/WeeklyScheduleBars';

type Props = { records: SleepRecord[]; weekStart: moment.Moment; timeZone: string; onSelectDay?: (date: string) => void };

export default function SleepBalanceCard({ records, weekStart, timeZone, onSelectDay }: Props) {
  const recorded = Array.from({ length: 7 }, (_, index) => recordForNight(
    records, weekStart.clone().add(index, 'days').format('YYYY-MM-DD'), timeZone,
  )).filter((record): record is SleepRecord => !!record);
  const summary = summarizeDurations(recorded.map(record => nightDuration(record.sleep_period_seconds)));
  const today = moment.tz(timeZone).startOf('day');
  const elapsedDays = Array.from({ length: 7 }, (_, index) => weekStart.clone().add(index, 'days'))
    .filter(day => day.isSameOrBefore(today, 'day'));
  const missingPastNight = elapsedDays.some(day => !recordForNight(recorded, day.format('YYYY-MM-DD'), timeZone));
  return (
    <GlassCard label="Weekly sleep">
      <Typography>{ recorded.length } of 7 nights recorded</Typography>
      { summary && (
        <Box sx={ { my: 1 } }>
          <Typography sx={ typography.metricValue }>
            { formatSleepDuration(summary.average) } in bed on average
          </Typography>
          <Typography variant="body2" color="text.secondary">
            { summary.average < SLEEP_GOAL_MIN_SECONDS ? 'Under' : summary.average > SLEEP_GOAL_MAX_SECONDS ? 'Over' : 'Within' }{ ' ' }
            the { SLEEP_RANGE_TEXT } range for time in bed.
          </Typography>
        </Box>
      ) }
      <Typography variant="body2" color="text.secondary" sx={ { mt: 1, mb: 2 } }>
        { missingPastNight ? 'Incomplete coverage. Missing nights are not counted as zero sleep.'
          : elapsedDays.length < 7 ? 'All nights so far recorded. Upcoming nights are not counted.'
            : 'Full recorded-night coverage for this week.' }
      </Typography>
      <WeeklyScheduleBars records={ recorded } weekStart={ weekStart } timeZone={ timeZone } onSelectDay={ onSelectDay }/>
    </GlassCard>
  );
}
