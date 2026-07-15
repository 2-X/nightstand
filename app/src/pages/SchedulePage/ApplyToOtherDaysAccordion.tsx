import {
  Accordion,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Typography
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { AccordionExpanded } from './SchedulePage.types.ts';
import { DayOfWeek } from '@api/schedulesSchema.ts';
import { useAppStore } from '@state/appStore.tsx';
import { useScheduleStore } from './scheduleStore';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';

export const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ACCORDION_NAME: AccordionExpanded = 'applyToDays';

export default function ApplyToOtherDaysAccordion() {
  const {
    selectedDays,
    toggleSelectedDay,
    accordionExpanded,
    setAccordionExpanded,
    selectedSchedule,
  } = useScheduleStore();
  const { isUpdating } = useAppStore();

  // Only turn a day ON if it isn't already selected, so these buttons are
  // idempotent: clicking "Weekdays" twice, or after manually checking one
  // weekday, always ends with every weekday selected instead of flipping
  // already-checked days back off.
  const setWeekdays = () => {
    // daysOfWeek is Sunday-first, so Monday-Friday is indices 1 through 5.
    daysOfWeek.slice(1, 6).map(day => {
      const lowerCaseDay = day.toLowerCase() as DayOfWeek;
      if (!selectedDays[lowerCaseDay]) toggleSelectedDay(lowerCaseDay);
    });
  };

  const setEveryday = () => {
    daysOfWeek.map(day => {
      const lowerCaseDay = day.toLowerCase() as DayOfWeek;
      if (!selectedDays[lowerCaseDay]) toggleSelectedDay(lowerCaseDay);
    });
  };

  const setWeekends= () => {
    // daysOfWeek is Sunday-first: Sunday is index 0, Saturday is index 6.
    const sunday = daysOfWeek[0].toLowerCase() as DayOfWeek;
    const saturday = daysOfWeek[6].toLowerCase() as DayOfWeek;
    if (!selectedDays[saturday]) toggleSelectedDay(saturday);
    if (!selectedDays[sunday]) toggleSelectedDay(sunday);
  };

  return (
    <Accordion
      sx={ { width: '100%', mt: -2 } }
      expanded={ accordionExpanded === ACCORDION_NAME }
      onChange={ () => setAccordionExpanded(ACCORDION_NAME) }
      disabled={ !selectedSchedule?.power.enabled }

    >
      <AccordionSummary expandIcon={ <ExpandMoreIcon/> }>
        <Typography sx={ { display: 'flex', alignItems: 'center', gap: 3 } }>
          <EventRepeatIcon /> Apply settings to other days
        </Typography>
      </AccordionSummary>
      <Box sx={ { mt: -2, p: 2 } }>
        <Box sx={ { display: 'flex', gap: 1 } }>
          <Button variant="contained" sx={ { mb: 1 } } onClick={ setWeekdays } >Weekdays</Button>
          <Button variant="contained" sx={ { mb: 1 } } onClick={ setWeekends }>Weekends</Button>
          <Button variant="contained" sx={ { mb: 1 } } onClick={ setEveryday }>Everyday</Button>
        </Box>
        <FormGroup>
          {
            daysOfWeek.map((day) => {
              const lowerCaseDay = day.toLowerCase() as DayOfWeek;
              return (
                <FormControlLabel
                  key={ day }
                  control={
                    <Checkbox
                      disabled={ isUpdating }
                      checked={ selectedDays[lowerCaseDay] }
                      onChange={ () => toggleSelectedDay(lowerCaseDay) }
                    />
                  }
                  label={ day }
                />
              );
            })
          }
        </FormGroup>
      </Box>
    </Accordion>
  );
}
