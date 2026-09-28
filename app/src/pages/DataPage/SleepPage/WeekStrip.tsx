import { Box, Button, Typography } from '@mui/material';
import moment from 'moment-timezone';
import type { SleepRecord } from '@api/sleepSchema';
import { recordForNight } from './sleepContext';

type Props = {
  weekStart: moment.Moment;
  selectedDate: string;
  timeZone: string;
  records: SleepRecord[];
  onSelectDay: (date: string) => void;
};

export default function WeekStrip({ weekStart, selectedDate, timeZone, records, onSelectDay }: Props) {
  const today = moment.tz(timeZone).startOf('day');
  return (
    <Box role="group" aria-label="Nights in selected week" sx={ { display: 'flex', width: '100%', gap: 0.5 } }>
      { Array.from({ length: 7 }, (_, index) => {
        const day = weekStart.clone().add(index, 'days');
        const date = day.format('YYYY-MM-DD');
        const recorded = !!recordForNight(records, date, timeZone);
        return (
          <Button
            key={ date }
            aria-label={ `${day.format('dddd, MMMM D')}: ${recorded ? 'recorded' : 'no recording'}` }
            aria-pressed={ date === selectedDate }
            disabled={ day.isAfter(today, 'day') }
            onClick={ () => onSelectDay(date) }
            variant={ date === selectedDate ? 'contained' : 'text' }
            sx={ { flex: 1, minWidth: 0, minHeight: 60, px: 0.25, flexDirection: 'column' } }
          >
            <Typography component="span" variant="caption">{ day.format('ddd') }</Typography>
            <Typography component="span">{ day.date() }</Typography>
            <Box
              component="span"
              aria-hidden
              sx={ { height: 4, width: 4, borderRadius: '50%', bgcolor: recorded ? 'currentColor' : 'transparent' } }/>
          </Button>
        );
      }) }
    </Box>
  );
}
