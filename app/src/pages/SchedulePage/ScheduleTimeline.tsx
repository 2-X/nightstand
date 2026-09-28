import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Box, Button, IconButton, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { useAppStore } from '@state/appStore';
import { fahrenheitToLevel, levelToFahrenheit, formatTemperature, TemperatureFormat } from '@lib/temperatureConversions';
import { MAX_ALARMS_PER_DAY } from '@api/schedulesSchema';
import { useScheduleStore } from './scheduleStore';
import { minutesSincePowerOn, temperatureInPowerWindow, timeInPowerWindow } from './scheduleValidation';

export default function ScheduleTimeline({ format }: { format: TemperatureFormat }) {
  const store = useScheduleStore();
  const schedule = store.selectedSchedule;
  const isUpdating = useAppStore(state => state.isUpdating);
  const [error, setError] = useState('');
  const rowKeys = useRef(new Map<string, number>());
  const nextKey = useRef(0);
  const focusTime = useRef<string | undefined>(undefined);
  const rows = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!focusTime.current) return;
    const input = rows.current?.querySelector<HTMLInputElement>(`input[data-time="${focusTime.current}"]`);
    input?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    input?.focus({ preventScroll: true });
    focusTime.current = undefined;
  });
  if (!schedule) return null;
  for (const time of Object.keys(schedule.temperatures)) {
    if (!rowKeys.current.has(time)) rowKeys.current.set(time, nextKey.current++);
  }
  const disabled = isUpdating || !schedule.power.enabled;
  const alarms = store.getEditedAlarms();
  const fullDay = schedule.power.on === schedule.power.off;
  const events = [
    { kind: 'start' as const, time: schedule.power.on, index: -1 },
    ...Object.keys(schedule.temperatures).map(time => ({ kind: 'temperature' as const, time, index: -1 })),
    ...alarms.map((alarm, index) => ({ kind: 'alarm' as const, time: alarm.time, index })),
    { kind: 'end' as const, time: schedule.power.off, index: -1 },
  ].sort((first, second) => {
    const firstOffset = first.kind === 'end' && fullDay ? 1440 : minutesSincePowerOn(first.time, schedule.power.on);
    const secondOffset = second.kind === 'end' && fullDay ? 1440 : minutesSincePowerOn(second.time, schedule.power.on);
    return firstOffset - secondOffset;
  });

  const changeTemperatureTime = (oldTime: string, newTime: string) => {
    if (oldTime !== newTime && Object.prototype.hasOwnProperty.call(schedule.temperatures, newTime)) {
      setError(`An adjustment already exists at ${newTime}. Choose another time.`);
      return;
    }
    setError('');
    const temperatures = { ...schedule.temperatures };
    const key = rowKeys.current.get(oldTime)!;
    rowKeys.current.delete(oldTime);
    rowKeys.current.set(newTime, key);
    delete temperatures[oldTime];
    temperatures[newTime] = schedule.temperatures[oldTime];
    store.updateSelectedTemperatures(temperatures);
  };
  const addTemperature = () => {
    const end = fullDay ? 1440 : minutesSincePowerOn(schedule.power.off, schedule.power.on);
    const [hour, minute] = schedule.power.on.split(':').map(Number);
    // Find the first free minute within this night rather than overwrite a row.
    const candidates = [60, ...Array.from({ length: end }, (_, index) => index + 1)];
    for (const offset of candidates) {
      if (offset >= end) continue;
      const total = (hour * 60 + minute + offset) % 1440;
      const time = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      if (!(time in schedule.temperatures)) {
        focusTime.current = time;
        store.updateSelectedTemperatures({ ...schedule.temperatures, [time]: 70 });
        return;
      }
    }
    setError('No free adjustment time remains in this power window.');
  };
  return <Stack ref={ rows } spacing={ 1 } sx={ { width: '100%' } }>
    { error && <Alert severity="error" onClose={ () => setError('') }>{ error }</Alert> }
    { events.map(event => {
      const alarm = event.kind === 'alarm' ? alarms[event.index] : undefined;
      const invalid = schedule.power.enabled && (event.kind === 'temperature' || alarm?.enabled)
        && !(event.kind === 'temperature' ? temperatureInPowerWindow : timeInPowerWindow)(event.time, schedule.power);
      return <Paper
        key={ `${event.kind}-${event.kind === 'temperature' ? rowKeys.current.get(event.time) : event.index}` }
        variant="outlined"
        data-testid="schedule-event"
        data-invalid={ invalid || undefined }
        sx={ { p: 2 } }>
        <Box sx={ { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 } }>
          <TextField
            label={ event.kind === 'start' ? 'Power on' : event.kind === 'end' ? 'Power off'
              : event.kind === 'alarm' ? 'Alarm time' : 'Adjustment time' }
            type="time"
            inputProps={ { 'data-time': event.kind === 'temperature' ? event.time : undefined } }
            size="small"
            value={ event.time }
            disabled={ disabled }
            error={ !!invalid }
            sx={ { width: 145 } }
            InputLabelProps={ { shrink: true } }
            onChange={ change => {
              const time = change.target.value;
              if (event.kind === 'start') store.updateSelectedSchedule({ power: { on: time } });
              if (event.kind === 'end') store.updateSelectedSchedule({ power: { off: time } });
              if (event.kind === 'temperature') changeTemperatureTime(event.time, time);
              if (event.kind === 'alarm') { store.selectAlarm(event.index); store.updateSelectedAlarm({ time }); }
            } } />
          { (event.kind === 'start' || event.kind === 'temperature') && <TextField
            select
            size="small"
            label="Temperature"
            disabled={ disabled }
            value={ format === 'level'
              ? levelToFahrenheit(fahrenheitToLevel(event.kind === 'start' ? schedule.power.onTemperature : schedule.temperatures[event.time]))
              : event.kind === 'start' ? schedule.power.onTemperature : schedule.temperatures[event.time] }
            sx={ { minWidth: 100 } }
            onChange={ change => {
              const value = Number(change.target.value);
              if (event.kind === 'start') store.updateSelectedSchedule({ power: { onTemperature: value } });
              else store.updateSelectedTemperatures({ ...schedule.temperatures, [event.time]: value });
            } }>
            { (format === 'level' ? Array.from({ length: 21 }, (_, index) => levelToFahrenheit(index - 10))
              : Array.from({ length: 56 }, (_, index) => index + 55)).map(value => (
              <MenuItem key={ value } value={ value }>{ formatTemperature(value, format) }</MenuItem>
            )) }
          </TextField> }
          { alarm && <>
            <Switch
              checked={ alarm.enabled }
              disabled={ disabled }
              slotProps={ { input: { 'aria-label': `Enable alarm ${event.index + 1}` } } }
              onChange={ change => { store.selectAlarm(event.index); store.updateSelectedAlarm({ enabled: change.target.checked }); } } />
            <Button
              size="small"
              disabled={ disabled }
              onClick={ () => {
                store.selectAlarm(event.index);
                if (store.accordionExpanded !== 'alarm') store.setAccordionExpanded('alarm');
              } }>Options</Button>
          </> }
          { (event.kind === 'temperature' || (event.kind === 'alarm' && alarms.length > 1)) && <IconButton
            aria-label={ event.kind === 'alarm' ? `Remove alarm ${event.index + 1}` : `Remove adjustment at ${event.time}` }
            disabled={ disabled }
            onClick={ () => {
              if (event.kind === 'alarm') store.removeAlarm(event.index);
              else {
                const temperatures = { ...schedule.temperatures };
                delete temperatures[event.time];
                store.updateSelectedTemperatures(temperatures);
              }
            } }><DeleteOutline /></IconButton> }
        </Box>
        { event.kind === 'end' && fullDay && <Typography variant="caption">Next day, after 24 hours</Typography> }
        { invalid && <Typography color="error" variant="caption">
          { event.kind === 'temperature' && event.time === schedule.power.off
            ? 'This change happens as the bed turns off, so it has no effect. Move it earlier or delete it.'
            : event.kind === 'temperature' && event.time === schedule.power.on
              ? 'This change happens as the bed turns on. Change the starting temperature or move it later.'
              : 'Time must be inside the power-on and power-off window.' }
        </Typography> }
      </Paper>;
    }) }
    <Box display="flex" flexWrap="wrap" gap={ 1 }>
      <Button onClick={ addTemperature } disabled={ disabled }>Add temperature change</Button>
      <Button onClick={ store.addAlarm } disabled={ disabled || alarms.length >= MAX_ALARMS_PER_DAY }>Add alarm</Button>
    </Box>
  </Stack>;
}
