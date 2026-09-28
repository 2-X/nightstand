import moment from 'moment-timezone';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, IconButton, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { useAppStore } from '@state/appStore';
import { TemperatureFormat } from '@lib/temperatureConversions';
import { MAX_ALARMS_PER_DAY } from '@api/schedulesSchema';
import { useScheduleStore } from './scheduleStore';
import { minutesSincePowerOn, temperatureInPowerWindow, timeInPowerWindow } from './scheduleValidation';
import { addMinutes, canFollowWake, nextTemperatureChange, relativeOffDelay, wakeTemperatureTimes } from './scheduleRoutine';
import TemperatureStepper from './TemperatureStepper';
import WakeVibrationSheet from './AlarmSection/WakeVibrationSheet';

export default function ScheduleTimeline({ format }: { format: TemperatureFormat }) {
  const store = useScheduleStore();
  const schedule = store.selectedSchedule;
  const isUpdating = useAppStore(state => state.isUpdating);
  const [error, setError] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [customOff, setCustomOff] = useState(false);
  const [offWarning, setOffWarning] = useState(false);
  const [rejectedDelay, setRejectedDelay] = useState<number>();
  const rowKeys = useRef(new Map<string, number>());
  const nextKey = useRef(0);
  const focusTime = useRef<string | undefined>(undefined);
  const [editing, setEditing] = useState<{ order: number[]; wake: number[]; wakeTime?: string } | undefined>(undefined);
  useEffect(() => {
    if (!store.changesPresent) {
      setCustomOff(false);
      setOffWarning(false);
      setRejectedDelay(undefined);
      setEditing(undefined);
    }
  }, [store.changesPresent]);
  useLayoutEffect(() => {
    if (!focusTime.current) return;
    const row = document.getElementById(`schedule-temperature-${focusTime.current}`);
    const input = row?.querySelector<HTMLElement>('input[type="time"], [role="combobox"]');
    input?.scrollIntoView?.({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    input?.focus({ preventScroll: true });
    focusTime.current = undefined;
  });
  if (!schedule) return null;
  const disabled = isUpdating || !schedule.power.enabled;
  const alarms = store.getEditedAlarms();
  const wakeIndex = alarms.reduce((earliest, alarm, index) => !alarm.enabled ? earliest
    : earliest < 0 || minutesSincePowerOn(alarm.time, schedule.power.on) < minutesSincePowerOn(alarms[earliest].time, schedule.power.on)
      ? index : earliest, -1);
  const wakeAlarm = alarms[wakeIndex];
  const wakeTimes = wakeTemperatureTimes(schedule, wakeAlarm?.time);
  const fullDay = schedule.power.on === schedule.power.off;
  const orderedTimes = Object.keys(schedule.temperatures).sort((first, second) =>
    minutesSincePowerOn(first, schedule.power.on) - minutesSincePowerOn(second, schedule.power.on));
  for (const time of orderedTimes) if (!rowKeys.current.has(time)) rowKeys.current.set(time, nextKey.current++);
  const draftOrder = (time: string) => {
    const index = editing?.order.indexOf(rowKeys.current.get(time)!);
    return index !== undefined && index >= 0 ? index : (editing?.order.length ?? 0) + orderedTimes.indexOf(time);
  };
  const times = editing ? [...orderedTimes].sort((first, second) => draftOrder(first) - draftOrder(second)) : orderedTimes;
  // Keep draft placement stable only while the wake anchor stays unchanged.
  const frozenWake = editing?.wakeTime === wakeAlarm?.time ? editing?.wake : undefined;
  const isWakeTime = (time: string) => frozenWake
    ? frozenWake.includes(rowKeys.current.get(time)!) : wakeTimes.includes(time);
  const delay = wakeAlarm ? relativeOffDelay(wakeAlarm.time, schedule.power.off) : undefined;
  const followDelay = rejectedDelay ?? delay;

  const freezeRows = () => setEditing(previous => {
    if (previous) {
      if (previous.wakeTime === wakeAlarm?.time) return previous;
    }
    return {
      order: previous?.order ?? times.map(value => rowKeys.current.get(value)!),
      wake: times.filter(isWakeTime).map(value => rowKeys.current.get(value)!),
      wakeTime: wakeAlarm?.time,
    };
  });
  const followWake = (time: string, minutes: number, power = schedule.power) => {
    const off = addMinutes(time, minutes);
    const allowed = canFollowWake(power, off);
    setOffWarning(!allowed);
    setRejectedDelay(allowed ? undefined : minutes);
    if (allowed) store.updateSelectedSchedule({ power: { off } });
  };
  const clearOffWarning = () => {
    setOffWarning(false);
    setRejectedDelay(undefined);
  };
  const changeTemperatureTime = (oldTime: string, newTime: string) => {
    if (!newTime) return;
    if (oldTime !== newTime && Object.prototype.hasOwnProperty.call(schedule.temperatures, newTime)) {
      setError(`A change already exists at ${moment(newTime, 'HH:mm').format('h:mm A')}. Choose another time.`);
      return;
    }
    setError('');
    freezeRows();
    const temperatures = { ...schedule.temperatures };
    const key = rowKeys.current.get(oldTime)!;
    rowKeys.current.delete(oldTime);
    rowKeys.current.set(newTime, key);
    delete temperatures[oldTime];
    temperatures[newTime] = schedule.temperatures[oldTime];
    store.updateSelectedTemperatures(temperatures);
  };
  const addTemperature = () => {
    const next = nextTemperatureChange(schedule);
    if (!next) { setError('No free adjustment time remains in this power window.'); return; }
    freezeRows();
    focusTime.current = next.time;
    store.updateSelectedTemperatures({ ...schedule.temperatures, [next.time]: next.temperature });
  };
  const removeTemperature = (time: string) => {
    freezeRows();
    const temperatures = { ...schedule.temperatures };
    delete temperatures[time];
    store.updateSelectedTemperatures(temperatures);
  };
  const renderTemperature = (time: string) => {
    const invalid = schedule.power.enabled && !temperatureInPowerWindow(time, schedule.power);
    const lead = wakeAlarm ? minutesSincePowerOn(wakeAlarm.time, time) : undefined;
    const warmUp = isWakeTime(time);
    const warmUpOptions = [...new Set([15, 30, ...(lead !== undefined ? [lead] : [])])]
      .filter(minutes => minutes === lead || (minutes > 0 && minutes < 60 && wakeAlarm
        && minutesSincePowerOn(wakeAlarm.time, schedule.power.on) > minutes))
      .sort((first, second) => first - second);
    return <Paper
      key={ rowKeys.current.get(time) }
      id={ `schedule-temperature-${time}` }
      variant="outlined"
      data-testid="schedule-event"
      data-invalid={ invalid || undefined }
      sx={ { p: 1.5, scrollMarginBlock: '100px' } }>
      <Box sx={ { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1 } }>
        { warmUp && wakeAlarm ? <TextField
          select
          size="small"
          label="Warm up"
          disabled={ disabled }
          value={ lead }
          sx={ { minWidth: 145, flex: 1 } }
          onChange={ event => changeTemperatureTime(time, addMinutes(wakeAlarm.time, -Number(event.target.value))) }>
          { warmUpOptions.map(minutes => <MenuItem value={ minutes } key={ minutes }>{ minutes } min before</MenuItem>) }
        </TextField> : <TextField
          label="Change at"
          type="time"
          inputProps={ { 'data-time': time } }
          size="small"
          value={ time }
          disabled={ disabled }
          error={ invalid }
          sx={ { width: 145 } }
          InputLabelProps={ { shrink: true } }
          onChange={ event => changeTemperatureTime(time, event.target.value) }/> }
        <IconButton
          aria-label={ `Remove adjustment at ${time}` }
          disabled={ disabled }
          sx={ { width: 48, height: 48 } }
          onClick={ () => removeTemperature(time) }><DeleteOutline/></IconButton>
        <TemperatureStepper
          value={ schedule.temperatures[time] }
          format={ format }
          label={ `Temperature at ${time}` }
          disabled={ disabled }
          onChange={ temperature => { freezeRows(); store.updateSelectedTemperatures({ ...schedule.temperatures, [time]: temperature }); } }/>
      </Box>
      { invalid && <Typography color="error" variant="caption">
        { time === schedule.power.off ? 'This change happens as the bed turns off, so it has no effect. Move it earlier or delete it.'
          : time === schedule.power.on ? 'This change happens as the bed turns on. Change the starting temperature or move it later.'
            : 'Time must be inside the power-on and power-off window.' }
      </Typography> }
    </Paper>;
  };
  return <Stack spacing={ 3 } sx={ { width: '100%' } }>
    { error && <Alert severity="error" onClose={ () => setError('') }>{ error }</Alert> }
    <Stack component="section" aria-labelledby="bedtime-heading" spacing={ 1 }>
      <Typography component="h2" variant="h6" id="bedtime-heading">Bedtime</Typography>
      <Paper id="schedule-bedtime" variant="outlined" data-testid="schedule-event" sx={ { p: 1.5 } }>
        <Box sx={ { display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', gap: 2 } }>
          <TextField
            label="Turn on at"
            type="time"
            size="small"
            value={ schedule.power.on }
            disabled={ disabled }
            sx={ { width: 145 } }
            InputLabelProps={ { shrink: true } }
            onChange={ event => {
              const on = event.target.value;
              if (!on) return;
              store.updateSelectedSchedule({ power: { on } });
              if (rejectedDelay !== undefined && !customOff) {
                const nextWake = alarms.filter(alarm => alarm.enabled).sort((first, second) =>
                  minutesSincePowerOn(first.time, on) - minutesSincePowerOn(second.time, on))[0];
                if (nextWake) followWake(nextWake.time, rejectedDelay, { ...schedule.power, on });
              }
            } }/>
          <TemperatureStepper
            value={ schedule.power.onTemperature }
            format={ format }
            label="Bedtime temperature"
            disabled={ disabled }
            onChange={ onTemperature => store.updateSelectedSchedule({ power: { onTemperature } }) }/>
        </Box>
      </Paper>
    </Stack>
    <Stack component="section" aria-labelledby="night-heading" spacing={ 1 }>
      <Typography component="h2" variant="h6" id="night-heading">Through the night</Typography>
      { times.filter(time => !isWakeTime(time)).map(renderTemperature) }
      { !times.some(time => !isWakeTime(time)) && <Typography variant="body2" color="text.secondary">
        Keep the bedtime temperature until wake-up.
      </Typography> }
      <Button onClick={ addTemperature } disabled={ disabled } sx={ { alignSelf: 'flex-start', minHeight: 44 } }>Add temperature change</Button>
    </Stack>
    <Stack component="section" aria-labelledby="wake-heading" spacing={ 1 }>
      <Box sx={ { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 } }>
        <Typography component="h2" variant="h6" id="wake-heading">{ wakeAlarm ? 'Wake up' : 'Get up' }</Typography>
        { alarms.map((alarm, index) => <FormControlLabel
          key={ index }
          label={ alarms.length === 1 ? 'Alarm' : `Alarm ${index + 1}` }
          sx={ { mr: 0 } }
          control={ <Switch
            checked={ alarm.enabled }
            disabled={ disabled }
            slotProps={ { input: { 'aria-label': `Enable alarm ${index + 1}` } } }
            onChange={ event => { store.selectAlarm(index); store.updateSelectedAlarm({ enabled: event.target.checked }); } }/> }/>) }
      </Box>
      { alarms.map((alarm, index) => {
        const invalid = schedule.power.enabled && alarm.enabled && !timeInPowerWindow(alarm.time, schedule.power);
        return <Paper
          key={ index }
          variant="outlined"
          data-testid="schedule-event"
          data-invalid={ invalid || undefined }
          sx={ { p: 1.5, opacity: alarm.enabled ? 1 : 0.6 } }>
          <Box sx={ { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1 } }>
            <TextField
              label="Alarm time"
              type="time"
              size="small"
              value={ alarm.time }
              disabled={ disabled }
              error={ invalid }
              InputLabelProps={ { shrink: true } }
              sx={ { width: 145 } }
              onChange={ event => {
                const time = event.target.value;
                if (!time) return;
                store.selectAlarm(index);
                store.updateSelectedAlarm({ time });
                if (alarm.enabled && !customOff && followDelay !== undefined) {
                  const nextWake = store.getEditedAlarms().filter(value => value.enabled).sort((first, second) =>
                    minutesSincePowerOn(first.time, schedule.power.on) - minutesSincePowerOn(second.time, schedule.power.on))[0];
                  followWake(nextWake.time, followDelay);
                }
              } }/>
            { alarms.length > 1 && <IconButton
              aria-label={ `Remove alarm ${index + 1}` }
              disabled={ disabled }
              sx={ { width: 48, height: 48 } }
              onClick={ () => store.removeAlarm(index) }><DeleteOutline/></IconButton> }
          </Box>
          { invalid && <Typography color="error" variant="caption">Time must be inside the power-on and power-off window.</Typography> }
          { alarm.enabled && <Button
            fullWidth
            disabled={ disabled }
            endIcon={ <ChevronRight/> }
            sx={ { justifyContent: 'space-between', textAlign: 'left', minHeight: 48, mt: 1 } }
            onClick={ () => { store.selectAlarm(index); setSheetOpen(true); } }>
            <span>Vibrate <Typography component="span" variant="body2" color="text.secondary">
              { alarm.vibrationPattern === 'rise' ? 'Builds up' : 'Double pulse' }, strength { alarm.vibrationIntensity } of 100,
              { ' ' }<Box component="span" sx={ { whiteSpace: 'nowrap' } }>{ alarm.duration } s</Box>
            </Typography></span>
          </Button> }
        </Paper>;
      }) }
      { times.filter(isWakeTime).map(renderTemperature) }
      { wakeAlarm && !times.some(isWakeTime) && timeInPowerWindow(wakeAlarm.time, schedule.power)
        && minutesSincePowerOn(wakeAlarm.time, schedule.power.on) > 30 && <Button
        disabled={ disabled }
        onClick={ () => {
          const time = addMinutes(wakeAlarm.time, -30);
          if (time in schedule.temperatures) {
            setError(`A change already exists at ${moment(time, 'HH:mm').format('h:mm A')}. Choose another time.`);
            return;
          }
          const key = nextKey.current++;
          rowKeys.current.set(time, key);
          setEditing(previous => previous ? { ...previous, order: [...previous.order, key], wake: [key], wakeTime: wakeAlarm.time } : previous);
          focusTime.current = time;
          store.updateSelectedTemperatures({ ...schedule.temperatures, [time]: schedule.power.onTemperature });
        } }
        sx={ { alignSelf: 'flex-start', minHeight: 44 } }>Add warm-up</Button> }
      <Paper variant="outlined" data-testid="schedule-event" sx={ { p: 1.5 } }>
        { wakeAlarm && <TextField
          select
          label="Turn off"
          size="small"
          fullWidth
          disabled={ disabled }
          value={ customOff || followDelay === undefined ? 'custom' : followDelay }
          sx={ { mb: customOff || followDelay === undefined ? 2 : 0 } }
          onChange={ event => {
            const value = event.target.value;
            setCustomOff(value === 'custom');
            clearOffWarning();
            if (value !== 'custom') followWake(wakeAlarm.time, Number(value));
          } }>
          <MenuItem value={ 0 }>At wake time</MenuItem><MenuItem value={ 15 }>15 min after</MenuItem>
          <MenuItem value={ 30 }>30 min after</MenuItem><MenuItem value={ 60 }>1 hour after</MenuItem>
          <MenuItem value="custom">At a set time</MenuItem>
        </TextField> }
        { (!wakeAlarm || customOff || followDelay === undefined) && <TextField
          label="Turn off at"
          type="time"
          size="small"
          value={ schedule.power.off }
          disabled={ disabled }
          InputLabelProps={ { shrink: true } }
          sx={ { width: 145 } }
          onChange={ event => {
            if (!event.target.value) return;
            clearOffWarning();
            store.updateSelectedSchedule({ power: { off: event.target.value } });
          } }/> }
        { wakeAlarm && !customOff && followDelay !== undefined && <Typography
          variant="caption"
          color="text.secondary"
          sx={ { display: 'block', mt: 1 } }>Turns off at { moment(schedule.power.off, 'HH:mm').format('h:mm A') }</Typography> }
        { offWarning && <Typography variant="caption" color="error" sx={ { display: 'block', mt: 1 } }>
          Wake time is before bedtime, so turn off was not moved.
        </Typography> }
        { customOff && delay !== undefined && <Typography variant="caption" color="text.secondary" sx={ { display: 'block', mt: 1 } }>
          Matches { delay === 0 ? 'wake time' : `${delay} min after wake` }, so it will move with your wake time.
        </Typography> }
        { fullDay && <Typography variant="caption" sx={ { display: 'block' } }>Next day, after 24 hours</Typography> }
      </Paper>
      <Button
        onClick={ store.addAlarm }
        disabled={ disabled || alarms.length >= MAX_ALARMS_PER_DAY }
        sx={ { alignSelf: 'flex-start', minHeight: 44 } }>Add alarm</Button>
    </Stack>
    <WakeVibrationSheet open={ sheetOpen } onClose={ () => setSheetOpen(false) }/>
  </Stack>;
}
