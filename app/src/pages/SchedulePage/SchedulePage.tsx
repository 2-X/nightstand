import _ from 'lodash';
import { useEffect } from 'react';
import { Box } from '@mui/material';
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
import TemperatureAdjustmentsAccordion from './TemperatureAdjustmentsAccordion.tsx';
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
  const { data: schedules, refetch } = useSchedules();
  const {
    selectedSchedule,
    setOriginalSchedules,
    selectedDays,
    selectedDay,
    reloadScheduleData,
    selectDay
  } = useScheduleStore();
  const { data: settings } = useSettings();
  const format = settings?.temperatureFormat ?? 'fahrenheit';
  // TODO: Add changes lost notification using changesPresent when user tries to switch tab before saving

  useEffect(() => {
    const day = getAdjustedDayOfWeek(settings?.timeZone);
    selectDay(LOWERCASE_DAYS.indexOf(day));
  }, [settings?.timeZone]);

  useEffect(() => {
    if (!schedules) return;
    setOriginalSchedules(schedules);
    const day = getAdjustedDayOfWeek(settings?.timeZone);
    selectDay(LOWERCASE_DAYS.indexOf(day));
    reloadScheduleData();
  }, [schedules, settings?.timeZone]);

  useEffect(() => {
    reloadScheduleData();
  }, [side]);

  // Discard any in-progress edits when the page unmounts (user navigates to
  // another tab). The store is a Zustand singleton that survives unmount, so
  // without this the user would come back and see their unsaved changes
  // still pending - which the user explicitly does not want here.
  useEffect(() => {
    return () => {
      reloadScheduleData();
    };
  }, [reloadScheduleData]);

  const handleSave = async () => {
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
      .catch(error => {
        console.error(error);
      })
      .finally(() => {
        setIsUpdating(false);
      });
  };

  return (
    <PageContainer
      sx={ {
        width: '100%',
        maxWidth: { xs: '100%', sm: '800px' },
        mx: 'auto',
        mb: 15,
      } }
    >
      <SideControl/>

      <DayTabs/>
      <ErrorBoundary componentName='Scheduling chart'>
        <TemperatureScheduleChart />
      </ErrorBoundary>

      <PowerScheduleSection format={ format }/>
      <Box sx={ { mt: 2, display: 'flex', justifyContent: 'space-between', width: '100%', mb: 2 } }>
        <EnabledSwitch/>
        <SaveButton onSave={ handleSave }/>
      </Box>
      <TemperatureAdjustmentsAccordion format={ format }/>
      <AlarmAccordion/>
      { settings?.features.oneOffAlarms && <OneOffAlarmSection/> }
      <ApplyToOtherDaysAccordion/>

    </PageContainer>
  );
}
