import { useEffect, useState } from 'react';
import moment from 'moment-timezone';
import { Box, Typography } from '@mui/material';
import { useAppStore } from '@state/appStore';
import { useSchedules } from '@api/schedules';
import { useSettings } from '@api/settings';
import { formatTemperature, TemperatureFormat } from '@lib/temperatureConversions.ts';
import { typography } from '@design/tokens';
import { nextBedEvent } from './bedEvents';

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
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 30_000); return () => clearInterval(timer); }, []);
  const pending = sliderTemp !== currentTargetTemp;
  const topTitle = pending ? 'Set to' : currentTemperatureF < currentTargetTemp ? 'Warming to'
    : currentTemperatureF > currentTargetTemp ? 'Cooling to' : 'Holding at';
  const event = settings && schedules && !settings[side].awayMode
    ? nextBedEvent(schedules[side], settings.timeZone, moment.tz(settings.timeZone), isOn ? 'off' : 'on') : undefined;
  const now = moment.tz(settings?.timeZone ?? 'UTC');
  const eventDay = event && (event.at.isSame(now, 'day') ? event.at.hour() >= 17 ? ' tonight' : ' today'
    : event.at.isSame(now.clone().add(1, 'day'), 'day') ? ' tomorrow' : ` ${event.at.format('ddd')}`);
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
    { event && <Typography variant="caption" color="text.secondary" sx={ { mt: 1 } }>
      { isOn ? 'Turns off' : 'Turns on' }{ eventDay } at { event.at.format('h:mm A') }
    </Typography> }
  </Box>;
}
