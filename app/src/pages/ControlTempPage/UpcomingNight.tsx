import SectionHeading from '@components/SectionHeading';
import { useEffect, useRef, useState } from 'react';
import moment from 'moment-timezone';
import { Box, Button, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import { useSchedules } from '@api/schedules.ts';
import { useSettings } from '@api/settings.ts';
import { isSchedulePaused } from '@api/schedulePause.ts';
import { useAppStore } from '@state/appStore.tsx';
import { formatTemperature } from '@lib/temperatureConversions.ts';
import { nextBedEvent } from './bedEvents';
import AlarmNotification from './AlarmNotification';
import PauseScheduleSheet from './PauseScheduleSheet';
import SchedulePauseNotice from './SchedulePauseNotice';

export default function UpcomingNight({ isOn }: { isOn?: boolean }) {
  const { side } = useAppStore();
  const { data: schedules, isError: schedulesError, refetch: refetchSchedules } = useSchedules();
  const { data: settings, isError: settingsError, refetch: refetchSettings } = useSettings();
  const [pauseOpen, setPauseOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Pausing and resuming swap the card's buttons; focus moves once the expected one exists.
  const [focusWhenPaused, setFocusWhenPaused] = useState<boolean | null>(null);
  const schedulePaused = !!settings && isSchedulePaused(settings, side, moment().toDate());
  useEffect(() => {
    if (focusWhenPaused !== schedulePaused) return;
    cardRef.current?.querySelector<HTMLElement>('[data-pause-control]')?.focus({ preventScroll: true });
    setFocusWhenPaused(null);
  }, [focusWhenPaused, schedulePaused]);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const retry = () => {
    if (!schedules) void refetchSchedules();
    if (!settings) void refetchSettings();
  };
  if (!settings || !schedules) {
    if (!schedulesError && !settingsError) return null;
    return (
      <Box sx={ { width: '100%', bgcolor: 'background.paper', borderRadius: '12px', border: 1, borderColor: 'divider', p: 2 } }>
        <SectionHeading>Tonight</SectionHeading>
        <Typography variant="body2" color="text.secondary" role="status">Schedule unavailable.</Typography>
        <Button size="small" sx={ { ml: -1 } } onClick={ retry }>Try again</Button>
      </Box>
    );
  }
  const next = !settings[side].awayMode && nextBedEvent(schedules[side], settings.timeZone);
  const event = isOn === false && next && next.kind === 'on'
    ? nextBedEvent(schedules[side], settings.timeZone, next.at.clone().add(1, 'millisecond')) : next;
  const temperature =
    event && event.temperature !== undefined ? formatTemperature(event.temperature, settings.temperatureFormat) : '';
  const override = settings[side].scheduleOverrides.temperatureSchedules;
  const paused = override.disabled && moment(override.expiresAt).isAfter(moment());
  const eventPaused = paused && !!event && moment(override.expiresAt).isAfter(event.at);
  const action =
    event &&
    (event.kind === 'off'
      ? 'Turns off'
      : event.kind === 'on'
        ? 'Turns on'
        : `Changes to ${temperature}`);
  const now = moment.tz(settings.timeZone);
  // An older server leaves pause out of its settings and would drop the write.
  const canPause = !schedulePaused && !settings[side].awayMode && !!settings[side].scheduleOverrides.pause;
  const eventDay = event && (event.at.isSame(now, 'day') ? event.at.hour() >= 17 ? 'tonight' : 'today'
    : event.at.isSame(now.clone().add(1, 'day'), 'day') ? 'tomorrow' : event.at.format('ddd'));
  const tonight = now.hour() >= 17 || (!!event && event.kind !== 'on' && event.at.isSame(now, 'day'));
  const eventText = event && `${action} ${eventDay} at ${event.at.format('h:mm A')}`
    + (event.kind === 'on' ? eventPaused ? ' and keeps your manual temperature' : `, set to ${temperature}` : '')
    + (event.kind === 'temperature' && eventPaused ? ' (currently paused)' : '');
  return (
    <Box ref={ cardRef } sx={ { width: '100%', bgcolor: 'background.paper', borderRadius: '12px', border: 1, borderColor: 'divider', p: 2 } }>
      <Box sx={ { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' } }>
        <SectionHeading>
          { tonight ? 'Tonight' : 'Upcoming' }
        </SectionHeading>
        <Box sx={ { display: 'flex', flexWrap: 'wrap', gap: 0.5 } }>
          { canPause && <Button size="small" data-pause-control onClick={ () => setPauseOpen(true) }>
            Pause schedule
          </Button> }
          <Button component={ Link } to="/schedules" size="small">
            Edit schedule
          </Button>
        </Box>
      </Box>
      { schedulePaused ? <SchedulePauseNotice onResumed={ () => setFocusWhenPaused(false) }/> : <>
        <Typography variant="body2" color="text.secondary" sx={ { mb: 1 } }>
          { event
            ? eventText
            : 'No upcoming power or temperature changes.' }
        </Typography>
        <AlarmNotification />
      </> }
      { pauseOpen && <PauseScheduleSheet
        open
        onPaused={ () => setFocusWhenPaused(true) }
        onClose={ () => { setPauseOpen(false); setFocusWhenPaused((expected) => expected ?? schedulePaused); } }/> }
    </Box>
  );
}
