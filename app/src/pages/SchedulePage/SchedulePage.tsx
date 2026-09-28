import _ from 'lodash';
import { useEffect, useRef, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, CircularProgress, Dialog, DialogTitle, DialogActions, Typography,
} from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { DeepPartial } from 'ts-essentials';
import moment from 'moment-timezone';

import OneOffAlarmSection from './OneOffAlarmSection.tsx';
import ApplyToOtherDaysAccordion from './ApplyToOtherDaysAccordion.tsx';
import DayTabs from './DayTabs.tsx';
import EnabledSwitch from './EnabledSwitch.tsx';
import PageContainer from '../PageContainer.tsx';
import SaveButton from './SaveButton.tsx';
import SideControl from '../../components/SideControl.tsx';
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
  const [pendingChange, setPendingChange] = useState<{ day: number } | { side: 'left' | 'right' }>();
  const changesPresent = useScheduleStore(state => state.changesPresent);
  const titleDay = selectedDay.charAt(0).toUpperCase() + selectedDay.slice(1);
  const nextDay = LOWERCASE_DAYS[(LOWERCASE_DAYS.indexOf(selectedDay) + 1) % 7];
  const sideLabel = side === 'left' ? 'Left' : 'Right';
  const affectedDays = _.uniq([selectedDay, ...Object.keys(selectedDays).filter(day => selectedDays[day as DayOfWeek])]);
  const unusedSide = !changesPresent && !!schedules?.[side] && Object.values(schedules[side]).every(day =>
    !day.power.enabled && Object.keys(day.temperatures).length === 0
    && !(day.alarms.length ? day.alarms : [day.alarm]).some(alarm => alarm.enabled));
  const firstRun = !selectedSchedule || unusedSide;
  const startNight = () => {
    const store = useScheduleStore.getState();
    store.updateSelectedSchedule({ power: { enabled: true } });
    store.selectAlarm(0);
    store.updateSelectedAlarm({ enabled: true });
  };

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

  const confirmDiscard = (change: { day: number } | { side: 'left' | 'right' }) => {
    if (!useScheduleStore.getState().changesPresent) return true;
    setPendingChange(change);
    return false;
  };
  const discardAndSwitch = () => {
    if (!pendingChange) return;
    reloadScheduleData();
    if ('day' in pendingChange) selectDay(pendingChange.day);
    else useAppStore.getState().setSide(pendingChange.side);
    setPendingChange(undefined);
  };

  const showInvalidRow = () => {
    const row = document.querySelector<HTMLElement>('[data-invalid="true"]');
    row?.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row?.querySelector<HTMLElement>('input[type="time"], [role="combobox"]')?.focus({ preventScroll: true });
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
    <Typography component="h1" variant="h1">Schedule</Typography>
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
      <Typography component="h1" variant="h1" sx={ { alignSelf: 'flex-start', mb: 1 } }>Schedule</Typography>
      <SideControl beforeSideChange={ nextSide => confirmDiscard({ side: nextSide }) }/>
      <DayTabs beforeDayChange={ day => confirmDiscard({ day }) }/>
      <Box sx={ { width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 } }>
        <Box>
          <Typography variant="subtitle1">
            { titleDay } night{ selectedSchedule && selectedSchedule.power.off < selectedSchedule.power.on
              ? ` to ${nextDay.charAt(0).toUpperCase() + nextDay.slice(1)} morning` : '' }
          </Typography>
          { settings.timeZone !== moment.tz.guess() && <Typography variant="caption" color="text.secondary">{ settings.timeZone }</Typography> }
        </Box>
        { !firstRun && <EnabledSwitch/> }
      </Box>
      { !firstRun ? <>
        <ErrorBoundary componentName="Scheduling chart"><TemperatureScheduleChart/></ErrorBoundary>
        <ScheduleTimeline key={ `${side}-${selectedDay}` } format={ format }/>
        <ApplyToOtherDaysAccordion/>
      </> : <Box sx={ { width: '100%', p: 3, border: 1, borderColor: 'divider', borderRadius: 2 } }>
        <Typography component="h2" variant="h6">Set a bedtime and a wake time</Typography>
        <Typography color="text.secondary" sx={ { my: 2 } }>
          Choose when the bed turns on and when you wake up, then adjust the temperature and vibration for this night.
        </Typography>
        <Button variant="contained" onClick={ startNight }>Set bedtime and wake time</Button>
      </Box> }
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
          Unsaved changes to { affectedDays.map(day => day.charAt(0).toUpperCase() + day.slice(1)).join(', ') }, { sideLabel } side
        </Typography>
        { saveError && <Alert severity="error" sx={ { my: 1 } }>{ saveError }</Alert> }
        <Box sx={ { display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1, gap: 1 } }>
          { !useScheduleStore.getState().isValid() && <Button size="small" color="error" onClick={ showInvalidRow }>Check invalid time</Button> }
          <Button onClick={ reloadScheduleData } disabled={ useAppStore.getState().isUpdating }>Discard</Button>
          <SaveButton onSave={ handleSave }/>
        </Box>
      </Box> }

      <Dialog open={ !!pendingChange } onClose={ () => setPendingChange(undefined) } aria-labelledby="discard-schedule-title">
        <DialogTitle id="discard-schedule-title">Discard changes to { titleDay }?</DialogTitle>
        <DialogActions>
          <Button onClick={ () => setPendingChange(undefined) } autoFocus>Keep editing</Button>
          <Button onClick={ discardAndSwitch }>Discard</Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
