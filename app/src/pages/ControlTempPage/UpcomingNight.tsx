import { useEffect, useState } from 'react';
import moment from 'moment-timezone';
import { Box, Button, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import { useSchedules } from '@api/schedules.ts';
import { useSettings } from '@api/settings.ts';
import { useAppStore } from '@state/appStore.tsx';
import { formatTemperature } from '@lib/temperatureConversions.ts';
import { nextBedEvent } from './bedEvents';
import AlarmNotification from './AlarmNotification';

export default function UpcomingNight() {
  const { side } = useAppStore();
  const { data: schedules } = useSchedules();
  const { data: settings } = useSettings();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!settings || !schedules) return null;
  const event = !settings[side].awayMode && nextBedEvent(schedules[side], settings.timeZone);
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
  const eventText = event && `${action} ${event.at.format('ddd')} at ${event.at.format('h:mm A')}`
    + (event.kind === 'on' ? eventPaused ? ' and keeps your manual temperature' : `, set to ${temperature}` : '')
    + (event.kind === 'temperature' && eventPaused ? ' (currently paused)' : '');
  return (
    <Box sx={ { width: '100%', bgcolor: 'background.paper', borderRadius: 2, p: 2 } }>
      <Box sx={ { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' } }>
        <Typography component="h2" variant="h6">
          Upcoming
        </Typography>
        <Button component={ Link } to="/schedules" size="small">
          Edit schedule
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={ { mb: 1 } }>
        { event
          ? eventText
          : 'No upcoming power or temperature changes.' }
      </Typography>
      <AlarmNotification />
    </Box>
  );
}
