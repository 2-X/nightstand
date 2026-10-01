import SectionHeading from '@components/SectionHeading';
import { useEffect, useRef, useState } from 'react';
import moment from 'moment-timezone';
import { Box, Button, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import { useSchedules } from '@api/schedules.ts';
import { useSettings } from '@api/settings.ts';
import { isSchedulePaused, pauseEndsAt } from '@api/schedulePause.ts';
import { useAppStore } from '@state/appStore.tsx';
import { formatTemperature } from '@lib/temperatureConversions.ts';
import { nextBedEvent } from './bedEvents';
import AlarmNotification from './AlarmNotification';
import PauseScheduleSheet from './PauseScheduleSheet';
import { MAX_PAUSE_DAYS } from './pauseTimes';
import SchedulePauseNotice from './SchedulePauseNotice';
import SmartPhaseLine from './SmartPhaseLine';
import { currentSleep, isEveningSleep, nextSleepEvent, sleepAt, warmStartBedtime, withArticle } from './sleepEvents';
import { useBedSleeps } from './useBedSleeps';

export default function UpcomingNight({ isOn }: { isOn?: boolean }) {
  const { side } = useAppStore();
  const { data: schedules, isError: schedulesError, refetch: refetchSchedules } = useSchedules();
  const { data: settings, isError: settingsError, refetch: refetchSettings } = useSettings();
  const bed = useBedSleeps(side);
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
    if (bed.state === 'error') bed.retry();
  };
  // While Rhythms runs the weekly schedules are not needed.
  const legacy = bed.state === 'legacy';
  if (!settings || bed.state === 'loading' || bed.state === 'error' || (legacy && !schedules)) {
    if (!settingsError && bed.state !== 'error' && !(legacy && schedulesError)) return null;
    return (
      <Box sx={ { width: '100%', bgcolor: 'background.paper', borderRadius: '12px', border: 1, borderColor: 'divider', p: 2 } }>
        <SectionHeading>Tonight</SectionHeading>
        <Typography variant="body2" color="text.secondary" role="status">Schedule unavailable.</Typography>
        <Button size="small" sx={ { ml: -1 } } onClick={ retry }>Try again</Button>
      </Box>
    );
  }
  const upcoming = (after?: moment.Moment, kind?: 'on' | 'off') => bed.state === 'rhythms'
    ? nextSleepEvent(bed.sleeps, settings.timeZone, after, kind)
    : schedules ? nextBedEvent(schedules[side], settings.timeZone, after, kind) : undefined;
  const next = !settings[side].awayMode && upcoming();
  const event = isOn === false && next && next.kind === 'on' ? upcoming(next.at.clone().add(1, 'millisecond')) : next;
  const current = bed.state === 'rhythms' && !settings[side].awayMode ? currentSleep(bed.sleeps, new Date()) : undefined;
  const smartSleep = current?.mode === 'smart' ? current : undefined;
  // Name the rhythm the next change belongs to, so a date change or weekday pick is easy to confirm.
  const eventSleep = bed.state === 'rhythms' && event ? sleepAt(bed.sleeps, event.at.toDate()) : undefined;
  const nameOf = (at: moment.Moment) => {
    const sleep = bed.state === 'rhythms' ? sleepAt(bed.sleeps, at.toDate()) : undefined;
    return bed.state === 'rhythms' && sleep?.rhythmId ? bed.names?.[sleep.rhythmId] : undefined;
  };
  const rhythmLabel = event ? nameOf(event.at) : undefined;
  const temperature =
    event && event.temperature !== undefined ? formatTemperature(event.temperature, settings.temperatureFormat) : '';
  const override = settings[side].scheduleOverrides.temperatureSchedules;
  const paused = override.disabled && moment(override.expiresAt).isAfter(moment());
  const eventPaused = paused && !!event && moment(override.expiresAt).isAfter(event.at);
  const bedtime = event && event.kind === 'on' ? warmStartBedtime(eventSleep, settings.timeZone) : undefined;
  const action =
    event &&
    (event.kind === 'off'
      ? 'Turns off'
      : event.kind === 'on'
        ? bedtime ? 'Starts warming' : 'Turns on'
        : `Changes to ${temperature}`);
  const now = moment.tz(settings.timeZone);
  // An older server leaves pause out of its settings and would drop the write.
  const canPause = !schedulePaused && !settings[side].awayMode && !!settings[side].scheduleOverrides.pause;
  const dayWord = (at: moment.Moment) => at.isSame(now, 'day') ? at.hour() >= 17 ? 'tonight' : 'today'
    : at.isSame(now.clone().add(1, 'day'), 'day') ? 'tomorrow' : at.format('ddd');
  const eventDay = event && dayWord(event.at);
  // During a sleep the heading names that sleep: "Tonight" for an evening one, "This sleep" for a day sleep.
  const heading = current ? isEveningSleep(current, settings.timeZone) ? 'Tonight' : 'This sleep'
    : bed.state === 'rhythms' ? now.hour() >= 17 || (!!event && event.at.isSame(now, 'day') && event.at.hour() >= 17) ? 'Tonight' : 'Upcoming'
      : now.hour() >= 17 || (!!event && event.kind !== 'on' && event.at.isSame(now, 'day')) ? 'Tonight' : 'Upcoming';
  // Under Rhythms an away side runs the present side's sleeps.
  const other = side === 'left' ? 'right' : 'left';
  const followsPartner = bed.state === 'rhythms' && settings[side].awayMode && !settings[other].awayMode;
  const partner = followsPartner ? settings[other].name || (other === 'left' ? 'Left side' : 'Right side') : '';
  const pauseEnd = schedulePaused ? pauseEndsAt(settings, side) : null;
  const backOn = pauseEnd && !settings[side].awayMode ? upcoming(moment(pauseEnd).subtract(1, 'ms'), 'on') : undefined;
  const backOnName = backOn ? nameOf(backOn.at) : undefined;
  const backOnText = backOn && `Back on schedule ${dayWord(backOn.at)} at ${backOn.at.format('h:mm A')}${backOnName ? ` (${backOnName})` : ''}`;
  const eventText = event && `${action} ${eventDay} at ${event.at.format('h:mm A')}`
    + (bedtime ? ` for ${withArticle(bedtime.format('h:mm A'))} bedtime` : '')
    + (event.kind === 'on' ? eventPaused ? ' and keeps your manual temperature' : `, set to ${temperature}` : '')
    + (event.kind === 'temperature' && eventPaused ? ' (currently paused)' : '')
    + (rhythmLabel ? ` (${rhythmLabel})` : '');
  return (
    <Box ref={ cardRef } sx={ { width: '100%', bgcolor: 'background.paper', borderRadius: '12px', border: 1, borderColor: 'divider', p: 2 } }>
      <Box sx={ { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' } }>
        <SectionHeading>
          { heading }
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
      { schedulePaused ? <SchedulePauseNotice detail={ backOnText || undefined } onResumed={ () => setFocusWhenPaused(false) }/> : <>
        { !(smartSleep && event && event.kind === 'temperature') && <Typography variant="body2" color="text.secondary" sx={ { mb: 1 } }>
          { event
            ? eventText
            : bed.state !== 'rhythms' ? 'No upcoming power or temperature changes.'
              : followsPartner ? <>Away mode is on, so this side follows <bdi>{ partner }</bdi>'s schedule.</>
                // useBedSleeps loads this far ahead.
                : `No sleep scheduled in the next ${MAX_PAUSE_DAYS} days.` }
        </Typography> }
        { smartSleep && <SmartPhaseLine sleep={ smartSleep } side={ side }/> }
        <AlarmNotification />
      </> }
      { pauseOpen && <PauseScheduleSheet
        open
        onPaused={ () => setFocusWhenPaused(true) }
        onClose={ () => { setPauseOpen(false); setFocusWhenPaused((expected) => expected ?? schedulePaused); } }/> }
    </Box>
  );
}
