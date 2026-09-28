import _ from 'lodash';
import { useEffect, useRef, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { DeepPartial } from 'ts-essentials';
import moment from 'moment-timezone';

import AlarmAccordion from './AlarmSection/AlarmAccordion.tsx';
import OneOffAlarmSection from './OneOffAlarmSection.tsx';
import ApplyToOtherDaysAccordion from './ApplyToOtherDaysAccordion.tsx';
import DayTabs from './DayTabs.tsx';
import EnabledSwitch from './EnabledSwitch.tsx';
import PageContainer from '../PageContainer.tsx';
import SaveButton from './SaveButton.tsx';
import SideControl from '../../components/SideControl.tsx';
import PowerScheduleSection from './PowerScheduleSection.tsx';
import ScheduleTimeline from './ScheduleTimeline';
import { DayOfWeek, Schedules } from '@api/schedulesSchema.ts';
import { postSchedules } from '@api/schedules';
import { useAppStore } from '@state/appStore.tsx';
import { useSchedules } from '@api/schedules';
import { useScheduleStore } from './scheduleStore.tsx';
import { useSettings } from '@api/settings';
import { LOWERCASE_DAYS } from './days.ts';
import TemperatureScheduleChart from './ScheduleChart.tsx';
import ErrorBoundary from '@components/ErrorBoundary.tsx';


const getAdjustedDayOfWeek = (timeZone?: string): DayOfWeek => {
  // Use the pod's configured timezone (where the schedule actually runs) rather
  // than the browser's, so the preselected day matches the pod for a user in a
  // different timezone. Falls back to local time until settings have loaded.
  const now = timeZone ? moment.tz(timeZone) : moment();
  // Extract the hour of the day in 24-hour format
  const currentHour = now.hour();

  // Determine if it's before noon (12:00 PM)
  if (currentHour < 12) {
    return now.subtract(1, 'day').format('dddd').toLocaleLowerCase() as DayOfWeek;
  } else {
    return now.format('dddd').toLocaleLowerCase() as DayOfWeek;
  }
};


export default function SchedulePage() {
  const { setIsUpdating, side } = useAppStore();
  const { data: schedules, refetch, isError: schedulesError } = useSchedules();
  const {
    selectedSchedule,
    setOriginalSchedules,
    selectedDays,
    selectedDay,
    reloadScheduleData,
    selectDay,
  } = useScheduleStore();
  const { data: settings, refetch: refetchSettings, isError: settingsError } = useSettings();
  const format = settings?.temperatureFormat ?? 'fahrenheit';
  const [saveError, setSaveError] = useState('');
  const changesPresent = useScheduleStore(state => state.changesPresent);
  const titleDay = selectedDay.charAt(0).toUpperCase() + selectedDay.slice(1);
  const nextDay = LOWERCASE_DAYS[(LOWERCASE_DAYS.indexOf(selectedDay) + 1) % 7];
  const sideLabel = side === 'left' ? 'Left' : 'Right';
  const affectedDays = _.uniq([selectedDay, ...Object.keys(selectedDays).filter(day => selectedDays[day as DayOfWeek])]);

  const initializedSide = useRef<typeof side | undefined>(undefined);
  useEffect(() => {
    if (!schedules || !settings) return;
    const current = useScheduleStore.getState();
    if (initializedSide.current === side && current.changesPresent) return;
    const day = initializedSide.current !== undefined ? current.selectedDay : getAdjustedDayOfWeek(settings.timeZone);
    initializedSide.current = side;
    setOriginalSchedules(schedules);
    selectDay(LOWERCASE_DAYS.indexOf(day));
  }, [schedules, settings?.timeZone, side]);

  // The store survives navigation, so discard unsaved edits when leaving.
  useEffect(() => () => reloadScheduleData(), [reloadScheduleData]);

  const confirmDiscard = () => {
    if (!useScheduleStore.getState().changesPresent) return true;
    if (!window.confirm(`Discard changes to ${titleDay}, ${side} side?`)) return false;
    useScheduleStore.setState({ changesPresent: false });
    return true;
  };

  const showInvalidRow = () => {
    const row = document.querySelector<HTMLElement>('[data-invalid="true"]');
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  };

  const handleSave = async () => {
    if (!useScheduleStore.getState().isValid()) return;
    setSaveError('');
    setIsUpdating(true);

    const daysList: DayOfWeek[] = _.uniq(_.keys(_.pickBy(selectedDays, value => value))) as DayOfWeek[];
    daysList.push(selectedDay);
    const payload: DeepPartial<Schedules> = { [side]: {}, };
    daysList.forEach(day => {
      // @ts-expect-error
      payload[side][day] = selectedSchedule;
    });

    await postSchedules(payload)
      .then(() => {
        // Wait 1 second before refreshing the schedules
        return new Promise((resolve) => setTimeout(resolve, 1_000));
      })
      .then(() => refetch())
      .then(result => {
        if (result.data) {
          const current = useScheduleStore.getState();
          useScheduleStore.setState({ originalSchedules: result.data });
          // A save may finish after navigation or after another edit.
          if (useAppStore.getState().side === side && current.selectedDay === selectedDay
            && current.selectedSchedule === selectedSchedule && current.selectedDays === selectedDays) reloadScheduleData();
        }
      })
      .catch(error => {
        console.error(error);
        setSaveError('Could not save the schedule. Your edits are still here. Try again.');
      })
      .finally(() => {
        setIsUpdating(false);
      });
  };

  // Editing requires schedules and the Pod timezone.
  if (!settings || !schedules) return <PageContainer>
    <Typography component="h1" variant="h5">Schedule</Typography>
    { schedulesError || settingsError ? <Alert
      severity="error"
      action={ <Button
        onClick={ () => {
          void refetch();
          void refetchSettings();
        } }>Retry</Button> }>Could not load the schedule and Pod timezone.</Alert>
      : <CircularProgress aria-label="Loading schedule and Pod timezone"/> }
  </PageContainer>;

  return (
    <PageContainer
      sx={ {
        width: '100%',
        maxWidth: { xs: '100%', sm: '800px' },
        mx: 'auto',
        mb: 15,
      } }
    >
      <Typography component="h1" variant="h5" sx={ { alignSelf: 'flex-start', mb: 1 } }>Schedule</Typography>
      <SideControl beforeSideChange={ confirmDiscard }/>
      <DayTabs beforeDayChange={ confirmDiscard }/>
      <Box sx={ { width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 } }>
        <Box>
          <Typography variant="subtitle1">
            { titleDay } night{ selectedSchedule && selectedSchedule.power.off < selectedSchedule.power.on
              ? ` to ${nextDay.charAt(0).toUpperCase() + nextDay.slice(1)} morning` : '' }
          </Typography>
          <Typography variant="caption" color="text.secondary">{ sideLabel } side · { settings?.timeZone }</Typography>
        </Box>
        <EnabledSwitch/>
      </Box>
      { selectedSchedule ? <ScheduleTimeline key={ `${side}-${selectedDay}` } format={ format }/> : <PowerScheduleSection format={ format }/> }
      <AlarmAccordion/>
      <ApplyToOtherDaysAccordion/>
      <Accordion sx={ { width: '100%' } }>
        <AccordionSummary expandIcon={ <ExpandMore/> }>Temperature chart</AccordionSummary>
        <AccordionDetails>
          <ErrorBoundary componentName="Scheduling chart"><TemperatureScheduleChart/></ErrorBoundary>
        </AccordionDetails>
      </Accordion>
      { settings?.features.oneOffAlarms && <Accordion sx={ { width: '100%', mt: 2 } } slotProps={ { transition: { unmountOnExit: true } } }>
        <AccordionSummary expandIcon={ <ExpandMore/> }>Add one-time alarm</AccordionSummary>
        <AccordionDetails><OneOffAlarmSection/></AccordionDetails>
      </Accordion> }
      { changesPresent && <Box
        sx={ {
          position: 'sticky', bottom: 80, mt: 2, width: '100%', p: 1, bgcolor: 'background.paper',
          border: 1, borderColor: 'divider', borderRadius: 2, zIndex: 2,
        } }>
        <Typography role="status" variant="body2">
          Unsaved · { sideLabel } side · { affectedDays.map(day => day.charAt(0).toUpperCase() + day.slice(1)).join(', ') }
        </Typography>
        { saveError && <Alert severity="error" sx={ { my: 1 } }>{ saveError }</Alert> }
        <Box sx={ { display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1, gap: 1 } }>
          { !useScheduleStore.getState().isValid() && <Button size="small" color="error" onClick={ showInvalidRow }>Check invalid time</Button> }
          <SaveButton onSave={ handleSave }/>
        </Box>
      </Box> }

    </PageContainer>
  );
}
