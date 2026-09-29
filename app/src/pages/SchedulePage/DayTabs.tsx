import { Box, Tab, Tabs } from '@mui/material';
import { useScheduleStore } from './scheduleStore.tsx';
import { useAppStore } from '@state/appStore.tsx';
import { LOWERCASE_DAYS } from './days.ts';

const formatDayLabel = (day: string) => `${day[0].toUpperCase()}${day.slice(1)}`;

export default function DayTabs({ beforeDayChange }: { beforeDayChange?: (day: number) => boolean }) {
  const { selectDay, selectedDayIndex } = useScheduleStore();
  const { isUpdating } = useAppStore();

  return (
    <Box sx={ { borderBottom: 1, borderColor: 'divider', width: { xs: 'calc(100% + 32px)', sm: '100%' }, mx: { xs: -2, sm: 0 } } }>
      <Tabs
        value={ selectedDayIndex || 0 }
        onChange={ (_, index: number) => { if (!beforeDayChange || beforeDayChange(index)) selectDay(index); } }
        aria-label="Days of the week"
        sx={ {
          width: '100%',
          '.MuiTabs-flexContainer': {
            display: 'flex',
            width: '100%',
          },
        } }
      >
        { LOWERCASE_DAYS.map((day, index) => (
          <Tab
            key={ index }
            disabled={ isUpdating }
            label={
              <Box
                sx={ {
                  display: 'flex',
                  justifyContent: 'center',
                  width: '100%',
                } }
              >
                { /* Mobile: 3 letters | Larger screens: full name */ }
                <Box sx={ { display: { xs: 'block', sm: 'none' } } }>
                  { formatDayLabel(day.substring(0, 3)) }
                </Box>
                <Box sx={ { display: { xs: 'none', sm: 'block' } } }>
                  { formatDayLabel(day) }
                </Box>
              </Box>
            }
            sx={ {
              flex: 1,
              minWidth: 0,
              paddingX: 1,
            } }
          />
        )) }
      </Tabs>
    </Box>
  );
}
