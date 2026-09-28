import moment from 'moment-timezone';
import { Box, Typography } from '@mui/material';
import type { SleepRecord } from '@api/sleepSchema';
import GlassCard from '@design/GlassCard';
import { recordForNight } from './sleepContext';

type Props = { records: SleepRecord[]; weekStart: moment.Moment; timeZone: string };

export default function WeeklyScheduleBars({ records, weekStart, timeZone }: Props) {
  return (
    <GlassCard label="Weekly timing">
      <Typography variant="body2" color="text.secondary" sx={ { mb: 1 } }>In bed / out of bed, by wake date</Typography>
      { Array.from({ length: 7 }, (_, index) => {
        const day = weekStart.clone().add(index, 'days');
        const record = recordForNight(records, day.format('YYYY-MM-DD'), timeZone);
        return (
          <Box
            key={ day.format('YYYY-MM-DD') }
            sx={ {
              display: 'flex', justifyContent: 'space-between', gap: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider',
            } }>
            <Typography variant="body2">{ day.format('ddd D') }</Typography>
            <Typography variant="body2" color={ record ? 'text.primary' : 'text.secondary' }>
              { record ? (
                <>
                  { moment.tz(record.entered_bed_at, timeZone).format('h:mm A') } / { moment.tz(record.left_bed_at, timeZone).format('h:mm A') }
                </>
              ) : 'No recording' }
            </Typography>
          </Box>
        );
      }) }
    </GlassCard>
  );
}
