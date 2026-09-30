import SectionHeading from '@components/SectionHeading';
import moment from 'moment-timezone';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, IconButton, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { useAppStore } from '@state/appStore';
import { TemperatureFormat } from '@lib/temperatureConversions';
import { AlarmSchedule, MAX_ALARMS_PER_DAY } from '@api/schedulesSchema';
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
  const [editing, setEditing] = useState<{
    order: number[]; wake: number[]; afterWake: number[]; offsets: Record<number, number>; wakeTime?: string; powerOn: string;
  } | undefined>(undefined);
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
  // Turn off follows the last alarm so the night never ends before one.
  const offAlarm = alarms.reduce<AlarmSchedule | undefined>((latest, alarm) => !alarm.enabled ? latest
    : !latest || minutesSincePowerOn(alarm.time, schedule.power.on) > minutesSincePowerOn(latest.time, schedule.power.on)
      ? alarm : latest, undefined);
  const wakeTimes = wakeTemperatureTimes(schedule, wakeAlarm?.time);
  const fullDay = schedule.power.on === schedule.power.off;
  const nightMinutes = fullDay ? 1440 : minutesSincePowerOn(schedule.power.off, schedule.power.on);
  const orderedTimes = Object.keys(schedule.temperatures).sort((first, second) =>
    minutesSincePowerOn(first, schedule.power.on) - minutesSincePowerOn(second, schedule.power.on));
  for (const time of orderedTimes) if (!rowKeys.current.has(time)) rowKeys.current.set(time, nextKey.current++);
  const draftOrder = (time: string) => {
    const index = editing?.order.indexOf(rowKeys.current.get(time)!);
    return index !== undefined && index >= 0 ? index : (editing?.order.length ?? 0) + orderedTimes.indexOf(time);
  };
  const times = editing ? [...orderedTimes].sort((first, second) => draftOrder(first) - draftOrder(second)) : orderedTimes;
  // Frozen offsets belong to both the bedtime and wake anchors.
  const anchorsUnchanged = editing?.wakeTime === wakeAlarm?.time && editing?.powerOn === schedule.power.on;
  const frozenWake = anchorsUnchanged ? editing?.wake : undefined;
  const isWakeTime = (time: string) => frozenWake
    ? frozenWake.includes(rowKeys.current.get(time)!) : wakeTimes.includes(time);
  const isAfterWake = (time: string) => anchorsUnchanged
    ? editing?.afterWake.includes(rowKeys.current.get(time)!) ?? false
    : !!wakeAlarm && minutesSincePowerOn(time, schedule.power.on) >= minutesSincePowerOn(wakeAlarm.time, schedule.power.on);
  const wakeOffset = (time: string) => (anchorsUnchanged
    ? editing?.offsets[rowKeys.current.get(time)!] : undefined) ?? minutesSincePowerOn(time, schedule.power.on);
  const orderedAlarms = alarms.map((alarm, index) => ({ alarm, index }))
    .sort((first, second) => minutesSincePowerOn(first.alarm.time, schedule.power.on)
      - minutesSincePowerOn(second.alarm.time, schedule.power.on));
  const isNightTime = (time: string) => !isWakeTime(time) && !isAfterWake(time);
  const timeHint = `Pick a time between ${moment(schedule.power.on, 'HH:mm').format('h:mm A')}`
    + ` and ${moment(schedule.power.off, 'HH:mm').format('h:mm A')}.`;
  const alarmHint = (time: string) => {
    const afterOff = minutesSincePowerOn(time, schedule.power.off) <= minutesSincePowerOn(schedule.power.on, time);
    return afterOff ? `Turn off is at ${moment(schedule.power.off, 'HH:mm').format('h:mm A')}, before this alarm.`
      + ' Move Turn off later or pick an earlier time.' : timeHint;
  };
  const rowGrid = { display: 'grid', gridTemplateColumns: '145px 1fr 44px',
    gridTemplateAreas: { xs: '"field . delete" "stepper stepper stepper"', sm: '"field stepper delete"' }, alignItems: 'center', gap: 1 };
  const manyAlarms = alarms.filter(value => value.enabled).length > 1;
  const afterLabel = manyAlarms ? ' last alarm' : '';
  const delay = offAlarm ? relativeOffDelay(offAlarm.time, schedule.power.off) : undefined;
  const followDelay = rejectedDelay ?? delay;

  const freezeRows = () => setEditing(previous => {
    if (previous) {
      if (previous.wakeTime === wakeAlarm?.time && previous.powerOn === schedule.power.on) return previous;
    }
    return {
      order: previous?.order ?? times.map(value => rowKeys.current.get(value)!),
      wake: times.filter(isWakeTime).map(value => rowKeys.current.get(value)!),
      afterWake: times.filter(isAfterWake).map(value => rowKeys.current.get(value)!),
      offsets: Object.fromEntries(times.map(time => [rowKeys.current.get(time)!, wakeOffset(time)])),
      wakeTime: wakeAlarm?.time,
      powerOn: schedule.power.on,
    };
  });
  const followWake = (time: string, minutes: number, power = schedule.power) => {
    const off = addMinutes(time, minutes);
    const allowed = canFollowWake(power, off);
    setOffWarning(!allowed);
    setRejectedDelay(allowed ? undefined : minutes);
    if (allowed) store.updateSelectedSchedule({ power: { off } });
  };
  // Alarm changes move the last alarm; a following turn-off moves with it.
  const refollowLastAlarm = () => {
    if (customOff || followDelay === undefined) return;
    const enabled = store.getEditedAlarms().filter(value => value.enabled);
    if (!enabled.length) return;
    const last = enabled.reduce((latest, value) => minutesSincePowerOn(value.time, schedule.power.on)
      > minutesSincePowerOn(latest.time, schedule.power.on) ? value : latest);
    followWake(last.time, followDelay);
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
      sx={ { p: 2, scrollMarginBlock: '100px' } }>
      <Box sx={ rowGrid }>
        { warmUp && wakeAlarm ? <TextField
          select
          size="small"
          label="Warm up"
          disabled={ disabled }
          value={ lead }
          sx={ { width: 145, gridArea: 'field' } }
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
          sx={ { width: 145, gridArea: 'field' } }
          InputLabelProps={ { shrink: true } }
          onChange={ event => changeTemperatureTime(time, event.target.value) }/> }
        <IconButton
          aria-label={ `Remove adjustment at ${time}` }
          disabled={ disabled }
          sx={ { width: 44, height: 44, gridArea: 'delete' } }
          onClick={ () => removeTemperature(time) }><DeleteOutline/></IconButton>
        <Box sx={ { gridArea: 'stepper', justifySelf: 'end' } }><TemperatureStepper
          value={ schedule.temperatures[time] }
          format={ format }
          label={ `Temperature at ${time}` }
          disabled={ disabled }
          onChange={ temperature => {
            freezeRows();
            store.updateSelectedTemperatures({ ...schedule.temperatures, [time]: temperature });
          } }/></Box>
      </Box>
      { invalid && <Typography color="error" variant="caption">
        { time === schedule.power.off ? 'This change happens as the bed turns off, so it has no effect. Move it earlier or delete it.'
          : time === schedule.power.on ? 'This change happens as the bed turns on. Change the starting temperature or move it later.'
            : timeHint }
      </Typography> }
    </Paper>;
  };
  return <Stack spacing={ 2 } sx={ { width: '100%' } }>
    { error && <Alert severity="error" onClose={ () => setError('') }>{ error }</Alert> }
    <Stack component="section" aria-labelledby="bedtime-heading" spacing={ 1 }>
      <SectionHeading id="bedtime-heading">Bedtime</SectionHeading>
      <Paper id="schedule-bedtime" variant="outlined" data-testid="schedule-event" sx={ { p: 2 } }>
        <Box sx={ rowGrid }>
          <TextField
            label="Turn on at"
            type="time"
            size="small"
            value={ schedule.power.on }
            disabled={ disabled }
            sx={ { width: 145, gridArea: 'field' } }
            InputLabelProps={ { shrink: true } }
            onChange={ event => {
              const on = event.target.value;
              if (!on) return;
              store.updateSelectedSchedule({ power: { on } });
              if (rejectedDelay !== undefined && !customOff) {
                const lastWake = alarms.filter(alarm => alarm.enabled).sort((first, second) =>
                  minutesSincePowerOn(second.time, on) - minutesSincePowerOn(first.time, on))[0];
                if (lastWake) followWake(lastWake.time, rejectedDelay, { ...schedule.power, on });
              }
            } }/>
          <Box sx={ { gridArea: 'stepper', justifySelf: 'end' } }><TemperatureStepper
            value={ schedule.power.onTemperature }
            format={ format }
            label="Bedtime temperature"
            disabled={ disabled }
            onChange={ onTemperature => store.updateSelectedSchedule({ power: { onTemperature } }) }/></Box>
        </Box>
        { nightMinutes > 16 * 60 && <Typography variant="body2" color="text.secondary" sx={ { mt: 1 } }>
          This night is { Math.floor(nightMinutes / 60) } h{ nightMinutes % 60 ? ` ${nightMinutes % 60} m` : '' } long
        </Typography> }
      </Paper>
    </Stack>
    <Stack component="section" aria-labelledby="night-heading" spacing={ 1 }>
      <SectionHeading id="night-heading">Through the night</SectionHeading>
      { times.filter(isNightTime).map(renderTemperature) }
      { !times.some(isNightTime) && <Typography variant="body2" color="text.secondary">
        Keep the bedtime temperature until wake-up.
      </Typography> }
      <Button onClick={ addTemperature } disabled={ disabled } sx={ { alignSelf: 'flex-start', px: 0 } }>Add temperature change</Button>
    </Stack>
    <Stack component="section" aria-labelledby="wake-heading" spacing={ 1 }>
      <SectionHeading id="wake-heading">{ wakeAlarm ? 'Wake up' : 'Get up' }</SectionHeading>
      { times.filter(isWakeTime).map(renderTemperature) }
      { orderedAlarms.flatMap(({ alarm, index }, alarmPosition) => {
        const invalid = schedule.power.enabled && alarm.enabled && !timeInPowerWindow(alarm.time, schedule.power);
        const nextAlarm = orderedAlarms[alarmPosition + 1]?.alarm;
        return [<Paper
          key={ `alarm-${index}` }
          variant="outlined"
          data-testid="schedule-event"
          data-invalid={ invalid || undefined }
          sx={ { p: 2, opacity: alarm.enabled ? 1 : 0.6 } }>
          <FormControlLabel
            label={ alarms.length === 1 ? 'Alarm' : `Alarm ${index + 1}` }
            labelPlacement="start"
            sx={ { m: 0, mb: 1, width: '100%', justifyContent: 'space-between' } }
            control={ <Switch
              checked={ alarm.enabled }
              disabled={ disabled }
              slotProps={ { input: { 'aria-label': `Enable alarm ${index + 1}` } } }
              onChange={ event => {
                store.selectAlarm(index);
                store.updateSelectedAlarm({ enabled: event.target.checked });
                refollowLastAlarm();
              } }/> }/>
          <Box
            sx={ { display: 'grid', gridTemplateColumns: '145px 1fr 44px',
              gridTemplateAreas: '"field . delete"', alignItems: 'center', gap: 1 } }>
            <TextField
              label="Wake at"
              type="time"
              size="small"
              value={ alarm.time }
              disabled={ disabled }
              error={ invalid }
              InputLabelProps={ { shrink: true } }
              sx={ { width: 145, gridArea: 'field' } }
              onChange={ event => {
                const time = event.target.value;
                if (!time) return;
                store.selectAlarm(index);
                store.updateSelectedAlarm({ time });
                if (alarm.enabled && !customOff && followDelay !== undefined) {
                  const lastWake = store.getEditedAlarms().filter(value => value.enabled).sort((first, second) =>
                    minutesSincePowerOn(second.time, schedule.power.on) - minutesSincePowerOn(first.time, schedule.power.on))[0];
                  followWake(lastWake.time, followDelay);
                }
              } }/>
            { alarms.length > 1 && <IconButton
              aria-label={ `Remove alarm ${index + 1}` }
              disabled={ disabled }
              sx={ { width: 44, height: 44, gridArea: 'delete' } }
              onClick={ () => { store.removeAlarm(index); refollowLastAlarm(); } }><DeleteOutline/></IconButton> }
          </Box>
          { invalid && <Typography color="error" variant="caption">{ alarmHint(alarm.time) }</Typography> }
          { alarm.enabled && <Button
            fullWidth
            disabled={ disabled }
            aria-label={ `Vibrate: ${alarm.vibrationPattern === 'rise' ? 'Builds up' : 'Double pulse'}, `
              + `strength ${alarm.vibrationIntensity}, ${alarm.duration} seconds` }
            endIcon={ <ChevronRight/> }
            sx={ { justifyContent: 'space-between', textAlign: 'left', minHeight: 44, mt: 1, px: 0 } }
            onClick={ () => { store.selectAlarm(index); setSheetOpen(true); } }>
            <Typography component="span" variant="body2" color="text.secondary">
              { alarm.vibrationPattern === 'rise' ? 'Builds up' : 'Double pulse' }, strength { alarm.vibrationIntensity },
              { ' ' }<Box component="span" sx={ { whiteSpace: 'nowrap' } }>{ alarm.duration } s</Box>
            </Typography>
          </Button> }
        </Paper>, ...times.filter(time => isAfterWake(time)
          && wakeOffset(time) >= minutesSincePowerOn(alarm.time, schedule.power.on)
          && (!nextAlarm || wakeOffset(time) < minutesSincePowerOn(nextAlarm.time, schedule.power.on))).map(renderTemperature)];
      }) }
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
          setEditing(previous => previous ? {
            ...previous, order: [...previous.order, key], wake: [key],
            afterWake: times.filter(isAfterWake).map(value => rowKeys.current.get(value)!),
            offsets: Object.fromEntries(times.map(value => [rowKeys.current.get(value)!, wakeOffset(value)])),
            wakeTime: wakeAlarm.time, powerOn: schedule.power.on } : previous);
          focusTime.current = time;
          store.updateSelectedTemperatures({ ...schedule.temperatures, [time]: schedule.power.onTemperature });
        } }
        sx={ { alignSelf: 'flex-start', px: 0 } }>Add warm-up</Button> }
      <Paper variant="outlined" data-testid="schedule-event" sx={ { p: 2 } }>
        <Box sx={ { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 } }>
          { offAlarm && <TextField
            select
            label="Turn off"
            size="small"
            disabled={ disabled }
            value={ customOff || followDelay === undefined ? 'custom' : followDelay }
            sx={ { width: manyAlarms ? 215 : 145 } }
            onChange={ event => {
              const value = event.target.value;
              setCustomOff(value === 'custom');
              clearOffWarning();
              if (value !== 'custom') followWake(offAlarm.time, Number(value));
            } }>
            <MenuItem value={ 0 }>{ manyAlarms ? 'At last alarm' : 'At wake time' }</MenuItem>
            <MenuItem value={ 15 }>15 min after{ afterLabel }</MenuItem>
            <MenuItem value={ 30 }>30 min after{ afterLabel }</MenuItem>
            <MenuItem value={ 60 }>1 hour after{ afterLabel }</MenuItem>
            <MenuItem value="custom">At a set time</MenuItem>
          </TextField> }
          { (!offAlarm || customOff || followDelay === undefined) && <TextField
            label={ offAlarm ? undefined : 'Turn off at' }
            inputProps={ { 'aria-label': 'Turn off at' } }
            type="time"
            size="small"
            value={ schedule.power.off }
            disabled={ disabled }
            InputLabelProps={ { shrink: true } }
            sx={ { width: 145, gridArea: 'field' } }
            onChange={ event => {
              if (!event.target.value) return;
              clearOffWarning();
              store.updateSelectedSchedule({ power: { off: event.target.value } });
            } }/> }
          { offAlarm && !customOff && followDelay !== undefined && <Typography
            variant="caption"
            color="text.secondary"
          >Turns off at { moment(schedule.power.off, 'HH:mm').format('h:mm A') }</Typography> }
        </Box>
        { offWarning && <Typography variant="caption" color="error" sx={ { display: 'block', mt: 1 } }>
          Wake time is before bedtime, so turn off was not moved.
        </Typography> }
        { customOff && delay !== undefined && <Typography variant="caption" color="text.secondary" sx={ { display: 'block', mt: 1 } }>
          Matches { delay === 0 ? 'wake time' : `${delay} min after wake` }, so it will move with your wake time.
        </Typography> }
        { fullDay && <Typography variant="caption" sx={ { display: 'block' } }>Next day, after 24 hours</Typography> }
      </Paper>
      { alarms.length > MAX_ALARMS_PER_DAY && <Typography role="status" variant="body2" color="text.secondary">
        { alarms.length } alarms are saved for this day. All are shown and can be edited or removed.
        Remove alarms until fewer than { MAX_ALARMS_PER_DAY } remain to add another.
      </Typography> }
      <Button
        onClick={ () => {
          store.addAlarm();
          const added = store.getEditedAlarms().slice(-1)[0];
          if (added && !customOff && followDelay !== undefined) followWake(added.time, followDelay);
        } }
        disabled={ disabled || alarms.length >= MAX_ALARMS_PER_DAY }
        sx={ { alignSelf: 'flex-start', px: 0 } }>Add alarm</Button>
    </Stack>
    <WakeVibrationSheet open={ sheetOpen } onClose={ () => setSheetOpen(false) }/>
  </Stack>;
}
