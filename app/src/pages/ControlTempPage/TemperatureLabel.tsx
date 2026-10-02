import { useEffect, useState } from 'react';
import moment from 'moment-timezone';
import { Box, Typography } from '@mui/material';
import { useAppStore } from '@state/appStore';
import { useDeviceStatus } from '@api/deviceStatus';
import { useRhythmsLive } from '@api/rhythms';
import { isSchedulePaused, pauseEndsAt } from '@api/schedulePause';
import { useSchedules } from '@api/schedules';
import { useSettings } from '@api/settings';
import { formatTemperature, TemperatureFormat } from '@lib/temperatureConversions.ts';
import { typography } from '@design/tokens';
import { nextBedEvent } from './bedEvents';
import { currentSleep, nextSleepEvent, sleepAt, warmStartBedtime } from './sleepEvents';
import { useBedSleeps } from './useBedSleeps';

type TemperatureLabelProps = {
  isOn: boolean;
  sliderTemp: number;
  sliderColor: string;
  currentTargetTemp: number;
  currentTemperatureF: number;
  format: TemperatureFormat;
};

export default function TemperatureLabel({
  isOn, sliderTemp, sliderColor, currentTargetTemp, currentTemperatureF, format,
}: TemperatureLabelProps) {
  const { side } = useAppStore();
  const { data: settings } = useSettings();
  const { data: schedules } = useSchedules();
  const { data: deviceStatus } = useDeviceStatus();
  const bed = useBedSleeps(side);
  const { data: live } = useRhythmsLive(side, bed.state === 'rhythms');
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 30_000); return () => clearInterval(timer); }, []);
  const pending = sliderTemp !== currentTargetTemp;
  const topTitle = pending ? 'Set to' : currentTemperatureF < currentTargetTemp ? 'Warming to'
    : currentTemperatureF > currentTargetTemp ? 'Cooling to' : 'Holding at';
  const kind = isOn ? 'off' : 'on';
  // While paused, scheduled turn-offs are skipped and the next start is the first one after the pause.
  const paused = !!settings && isSchedulePaused(settings, side, new Date());
  const pauseEnd = settings && paused ? pauseEndsAt(settings, side) : null;
  const searchFrom = settings && (pauseEnd ? moment.tz(pauseEnd, settings.timeZone).subtract(1, 'ms') : moment.tz(settings.timeZone));
  const event = !settings || !searchFrom || settings[side].awayMode || (paused && (isOn || !pauseEnd)) ? undefined
    : bed.state === 'rhythms' ? nextSleepEvent(bed.sleeps, settings.timeZone, searchFrom, kind)
      : bed.state === 'legacy' && schedules ? nextBedEvent(schedules[side], settings.timeZone, searchFrom, kind)
        : undefined;
  const now = moment.tz(settings?.timeZone ?? 'UTC');
  // The firmware timer still turns a running side off during a pause.
  const timer = deviceStatus?.[side]?.secondsRemaining;
  const timerOff = paused && isOn && timer && timer > 0 ? now.clone().add(timer, 'seconds') : undefined;
  // Between nights the firmware timer turns a running side off: after a sleep kept on when Rhythms was turned off,
  // after tonight's running sleep is removed, or after a manual start.
  const running = isOn && !paused && !!settings && !settings[side].awayMode;
  const nextStart = !running ? undefined
    : bed.state === 'rhythms' ? nextSleepEvent(bed.sleeps, settings.timeZone, now, 'on')
      : bed.state === 'legacy' && schedules ? nextBedEvent(schedules[side], settings.timeZone, now, 'on') : undefined;
  const timerEnd = running && (bed.state === 'rhythms' || (bed.state === 'legacy' && !!schedules)) && timer && timer > 0
    ? now.clone().add(timer, 'seconds') : undefined;
  const betweenNights = bed.state === 'rhythms' ? !currentSleep(bed.sleeps, now.toDate())
    : !event || (!!nextStart && nextStart.at.isBefore(event.at));
  const turnsOff = timerEnd && betweenNights && (!nextStart || timerEnd.isBefore(nextStart.at)) ? timerEnd : event?.at;
  const warming = !isOn && !!event && bed.state === 'rhythms' && !!settings
    && !!warmStartBedtime(sleepAt(bed.sleeps, event.at.toDate()), settings.timeZone);
  // A "When I get up" sleep turns off when the person gets up, by its latest off.
  const upBy = isOn && !paused && !!settings && !settings[side].awayMode && live?.offWhenUp
    ? moment.tz(live.offWhenUp.by, settings.timeZone) : undefined;
  const shownAt = upBy ?? (isOn ? turnsOff : event?.at);
  const eventDay = shownAt && (shownAt.isSame(now, 'day') ? shownAt.hour() >= 17 ? ' tonight' : ' today'
    : shownAt.isSame(now.clone().add(1, 'day'), 'day') ? ' tomorrow' : ` ${shownAt.format('ddd')}`);
  return <Box
    sx={ {
      position: 'absolute', inset: '18% 5% 15%', textAlign: 'center', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', gap: 0.5,
    } }>
    { isOn ? <>
      <Typography variant="body2" color="text.secondary">{ topTitle }</Typography>
      <Typography
        component="h2"
        sx={ {
          ...typography.hero, color: sliderColor, whiteSpace: 'nowrap',
          fontSize: format === 'level' ? typography.hero.fontSize : 'clamp(2.5rem, 13vw, 3.5rem)',
        } }>{ formatTemperature(sliderTemp, format) }</Typography>
      <Typography variant="body2" color="text.secondary">Currently at { formatTemperature(currentTemperatureF, format) }</Typography>
    </> : <Typography sx={ typography.hero } color="text.secondary">Off</Typography> }
    { shownAt && <Typography variant="caption" color="text.secondary" sx={ { mt: 1 } }>
      { upBy ? `Turns off when you get up,${eventDay} by ${upBy.format('h:mm A')}`
        : `${isOn ? 'Turns off' : warming ? 'Starts warming' : 'Turns on'}${eventDay} at ${shownAt.format('h:mm A')}` }
    </Typography> }
    { paused && isOn && <Typography variant="caption" color="text.secondary" sx={ { mt: 1 } }>
      { timerOff ? `Turns off at ${timerOff.format('h:mm A')}` : 'Stays on until you turn it off' }
    </Typography> }
  </Box>;
}
