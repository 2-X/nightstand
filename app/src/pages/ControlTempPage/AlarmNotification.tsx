import moment from 'moment-timezone';
import AlarmIcon from '@mui/icons-material/Alarm';
import AlarmOffIcon from '@mui/icons-material/AlarmOff';
import { Alert, Box, Button, Typography } from '@mui/material';
import { useAppStore } from '@state/appStore.tsx';
import { useSchedules } from '@api/schedules.ts';
import { useSettings } from '@api/settings.ts';
import { useEffect, useState } from 'react';
import AlarmOverride from './AlarmOverride.tsx';
import AlarmDisabledDialog from './AlarmDisabledDialog.tsx';
import { nextAlarmNight } from './AlarmNight';

export default function AlarmNotification() {
  const { side } = useAppStore();
  const { data: schedules } = useSchedules();
  const { data: settings } = useSettings();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [disabledOpen, setDisabledOpen] = useState(false);
  const [alarmTimeLocalOverride, setAlarmTimeLocalOverride] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick(value => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setAlarmTimeLocalOverride('');
    setOverrideOpen(false);
    setDisabledOpen(false);
  }, [side]);

  if (!settings || !schedules || !settings[side].alarmsEnabled || settings[side].awayMode) return null;
  const override = settings[side].scheduleOverrides.alarm;
  const night = nextAlarmNight(schedules[side], settings.timeZone, moment.tz(settings.timeZone), override);
  if (!night) return null;
  const expires = moment(override.expiresAt);
  const hasOverride = !!override.expiresAt && expires.isBetween(night.start, night.end, undefined, '(]');
  const disabled = hasOverride && override.disabled;
  const time = hasOverride && override.timeOverride ? override.timeOverride : night.alarms[0].alarm.time;
  const replacement = night.start.clone().hour(Number(time.split(':')[0])).minute(Number(time.split(':')[1]));
  if (time < night.start.format('HH:mm')) replacement.add(1, 'day');
  const replacementFinished = hasOverride && !!override.timeOverride && replacement.isBefore(moment());
  const scope = `${settings[side].name || (side === 'left' ? 'Left' : 'Right')} · ${night.start.format('ddd, MMM D')} night`;
  const alarmDate = hasOverride && override.timeOverride ? replacement : night.alarms[0].at;
  const now = moment.tz(settings.timeZone);
  const alarmDay = alarmDate?.isSame(now, 'day') ? 'today'
    : alarmDate?.isSame(now.clone().add(1, 'day'), 'day') ? 'tomorrow' : alarmDate?.format('ddd');
  return (
    <Alert
      icon={ disabled ? <AlarmOffIcon /> : <AlarmIcon /> }
      severity="info"
      sx={ { width: '100%', p: 0, background: 'transparent', border: 0, color: 'text.primary', '& .MuiAlert-message': { width: '100%' } } }>
      <AlarmOverride
        open={ overrideOpen }
        setOverrideOpen={ setOverrideOpen }
        alarmTimeLocalOverride={ alarmTimeLocalOverride }
        setAlarmTimeLocalOverride={ setAlarmTimeLocalOverride }
        scheduledAlarmTimeHhMm={ time }
        nightStart={ night.start.format() }
        nightEnd={ night.end.format() }
        scope={ scope } />
      <AlarmDisabledDialog
        open={ disabledOpen }
        setOpen={ setDisabledOpen }
        alarmDisabled={ disabled }
        nightEnd={ night.end.format() }
        scope={ scope } />
      <Box display="flex" flexWrap="wrap" alignItems="center" justifyContent="space-between" gap={ 1 }>
        { disabled ? <Typography variant="body2">Recurring alarms skipped</Typography>
          : replacementFinished ? <Typography variant="body2">Recurring alarms replaced for this night</Typography>
            : <Typography variant="body2">Alarm { alarmDay } at { moment(time, 'HH:mm').format('h:mm A') }</Typography> }
        <Box sx={ { display: 'flex', gap: 1 } }>
          { !disabled && !replacementFinished && <Button size="small" onClick={ () => setOverrideOpen(true) }>Change</Button> }
          <Button size="small" onClick={ () => setDisabledOpen(true) }>{ disabled ? 'Restore alarm' : 'Skip' }</Button>
        </Box>
      </Box>
    </Alert>
  );
}
