import { useEffect, useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  FormControlLabel, InputLabel, MenuItem, Select, Slider, Switch, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import type { RecurringAlarm, Recurrence } from '@api/schedulesSchema.ts';
import {
  SMART_WAKE_MIN_WINDOW_MINUTES,
  SMART_WAKE_MAX_WINDOW_MINUTES,
  SMART_WAKE_DEFAULT_WINDOW_MINUTES,
} from '@api/schedulesSchema.ts';
import { palette } from '@design/tokens';
import moment from 'moment-timezone';

type RecurrenceKind = Recurrence['kind'];
const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function makeDefaultAlarm(): RecurringAlarm {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `a-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    time: '07:00',
    recurrence: { kind: 'daily' },
    vibration: { intensity: 60, duration: 90, pattern: 'rise' },
    enabled: true,
  };
}

type Props = {
  open: boolean;
  initial: RecurringAlarm | null; // null = new alarm
  onCancel: () => void;
  onSave: (alarm: RecurringAlarm) => void;
};

export default function AlarmEditorDialog({ open, initial, onCancel, onSave }: Props) {
  const [alarm, setAlarm] = useState<RecurringAlarm>(() => initial ?? makeDefaultAlarm());

  useEffect(() => {
    if (open) setAlarm(initial ? { ...initial } : makeDefaultAlarm());
  }, [open, initial]);

  const kind = alarm.recurrence.kind;
  const customDays = alarm.recurrence.kind === 'customDays' ? alarm.recurrence.days : [];
  const everyN = alarm.recurrence.kind === 'everyNDays' ? alarm.recurrence.n : 2;

  const setKind = (next: RecurrenceKind) => {
    let recurrence: Recurrence;
    switch (next) {
    case 'customDays': recurrence = { kind: 'customDays', days: customDays.length ? customDays : [1] }; break;
    case 'everyNDays': recurrence = { kind: 'everyNDays', n: everyN, anchorDate: moment().format('YYYY-MM-DD') }; break;
    case 'weekdays': recurrence = { kind: 'weekdays' }; break;
    case 'weekends': recurrence = { kind: 'weekends' }; break;
    default: recurrence = { kind: 'daily' };
    }
    setAlarm((a) => ({ ...a, recurrence }));
  };

  const toggleCustomDay = (day: number) => {
    setAlarm((a) => {
      const days = a.recurrence.kind === 'customDays' ? [...a.recurrence.days] : [];
      const idx = days.indexOf(day);
      if (idx >= 0) days.splice(idx, 1); else days.push(day);
      return { ...a, recurrence: { kind: 'customDays', days: days.length ? days.sort((x, y) => x - y) : [day] } };
    });
  };

  const warmRamp = alarm.warmRampMinutes ?? 0;

  const smartWakeOn = alarm.smartWake?.enabled ?? false;
  const smartWakeWindow = alarm.smartWake?.windowMinutes ?? SMART_WAKE_DEFAULT_WINDOW_MINUTES;
  const setSmartWakeEnabled = (enabled: boolean) => {
    setAlarm((a) => ({
      ...a,
      smartWake: enabled
        ? { enabled: true, windowMinutes: a.smartWake?.windowMinutes ?? SMART_WAKE_DEFAULT_WINDOW_MINUTES }
        : undefined, // off => drop the key entirely (parses as a plain alarm)
    }));
  };
  const setSmartWakeWindow = (windowMinutes: number) => {
    setAlarm((a) => ({ ...a, smartWake: { enabled: true, windowMinutes } }));
  };

  return (
    <Dialog open={ open } onClose={ onCancel } fullWidth maxWidth="xs">
      <DialogTitle>{ initial ? 'Edit alarm' : 'New alarm' }</DialogTitle>
      <DialogContent>
        <Box sx={ { display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 } }>
          <TextField
            label="Time"
            type="time"
            value={ alarm.time }
            onChange={ (e) => setAlarm((a) => ({ ...a, time: e.target.value })) }
            variant="standard"
            sx={ { width: 130 } }
          />

          <FormControl variant="standard" fullWidth>
            <InputLabel>Repeat</InputLabel>
            <Select value={ kind } onChange={ (e) => setKind(e.target.value as RecurrenceKind) }>
              <MenuItem value="daily">Every day</MenuItem>
              <MenuItem value="weekdays">Weekdays (Mon–Fri)</MenuItem>
              <MenuItem value="weekends">Weekends (Sat–Sun)</MenuItem>
              <MenuItem value="customDays">Custom days</MenuItem>
              <MenuItem value="everyNDays">Every N days</MenuItem>
            </Select>
          </FormControl>

          { kind === 'customDays' && (
            <ToggleButtonGroup size="small" sx={ { flexWrap: 'wrap' } }>
              { DAY_ABBR.map((label, day) => (
                <ToggleButton
                  key={ day }
                  value={ day }
                  selected={ customDays.includes(day) }
                  onClick={ () => toggleCustomDay(day) }
                >
                  { label }
                </ToggleButton>
              )) }
            </ToggleButtonGroup>
          ) }

          { kind === 'everyNDays' && (
            <TextField
              label="Every N days"
              type="number"
              value={ everyN }
              onChange={ (e) => {
                const n = Math.max(1, Math.min(365, Number(e.target.value) || 1));
                setAlarm((a) => ({ ...a, recurrence: { kind: 'everyNDays', n, anchorDate: a.recurrence.kind === 'everyNDays' ? a.recurrence.anchorDate : moment().format('YYYY-MM-DD') } }));
              } }
              variant="standard"
              inputProps={ { min: 1, max: 365 } }
              sx={ { width: 130 } }
            />
          ) }

          <Box>
            <Typography sx={ { fontSize: '0.8rem', color: palette.text.secondary, mb: 0.5 } }>
              Vibration intensity: { alarm.vibration.intensity }
            </Typography>
            <Slider
              value={ alarm.vibration.intensity }
              min={ 1 }
              max={ 100 }
              onChange={ (_, v) => setAlarm((a) => ({ ...a, vibration: { ...a.vibration, intensity: v as number } })) }
            />
          </Box>

          <FormControl variant="standard" fullWidth>
            <InputLabel>Pattern</InputLabel>
            <Select
              value={ alarm.vibration.pattern }
              onChange={ (e) => setAlarm((a) => ({ ...a, vibration: { ...a.vibration, pattern: e.target.value as 'double' | 'rise' } })) }
            >
              <MenuItem value="rise">Rise</MenuItem>
              <MenuItem value="double">Double</MenuItem>
            </Select>
          </FormControl>

          <FormControl variant="standard" fullWidth>
            <InputLabel>Duration</InputLabel>
            <Select
              value={ alarm.vibration.duration }
              onChange={ (e) => setAlarm((a) => ({ ...a, vibration: { ...a.vibration, duration: Number(e.target.value) } })) }
            >
              { [30, 60, 90, 120, 180, 240, 300].map((s) => (
                <MenuItem key={ s } value={ s }>{ s }s</MenuItem>
              )) }
            </Select>
          </FormControl>

          <FormControl variant="standard" fullWidth>
            <InputLabel>Warm-ramp lead</InputLabel>
            <Select
              value={ warmRamp }
              onChange={ (e) => {
                const m = Number(e.target.value);
                setAlarm((a) => ({ ...a, warmRampMinutes: m > 0 ? m : undefined }));
              } }
            >
              <MenuItem value={ 0 }>Off</MenuItem>
              { [10, 15, 20, 30, 45, 60].map((m) => (
                <MenuItem key={ m } value={ m }>{ m } min before</MenuItem>
              )) }
            </Select>
          </FormControl>

          <Box sx={ { borderTop: `1px solid ${palette.border.subtle}`, pt: 1.5, mt: 0.5 } }>
            <FormControlLabel
              control={
                <Switch
                  checked={ smartWakeOn }
                  onChange={ (e) => setSmartWakeEnabled(e.target.checked) }
                  inputProps={ { 'aria-label': 'Smart wake' } }
                />
              }
              label="Smart wake"
              sx={ { color: palette.text.primary, ml: 0 } }
            />
            <Typography sx={ { fontSize: '0.75rem', color: palette.text.tertiary, mt: -0.5, mb: 0.5 } }>
              Wake from light sleep inside a window before this alarm. The alarm still
              rings on time no matter what.
            </Typography>
            { smartWakeOn && (
              <Box sx={ { px: 0.5 } }>
                <Typography sx={ { fontSize: '0.8rem', color: palette.text.secondary, mb: 0.5 } }>
                  Wake window: { smartWakeWindow } min before
                </Typography>
                <Slider
                  aria-label="Smart wake window minutes"
                  value={ smartWakeWindow }
                  min={ SMART_WAKE_MIN_WINDOW_MINUTES }
                  max={ SMART_WAKE_MAX_WINDOW_MINUTES }
                  step={ 5 }
                  marks
                  valueLabelDisplay="auto"
                  onChange={ (_, v) => setSmartWakeWindow(v as number) }
                />
              </Box>
            ) }
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={ onCancel } color="inherit">Cancel</Button>
        <Button onClick={ () => onSave(alarm) } variant="contained">Save</Button>
      </DialogActions>
    </Dialog>
  );
}
