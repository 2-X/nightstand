import { useState } from 'react';
import moment from 'moment-timezone';
import { Alert, Box, Button, Drawer, FormControlLabel, Radio, RadioGroup, TextField, Typography } from '@mui/material';
import { postSettings, useSettings } from '@api/settings.ts';
import { useSchedules } from '@api/schedules.ts';
import { useAppStore } from '@state/appStore.tsx';
import { friendlyTimeZone } from '@lib/timeZone';
import { serverMessage } from '@lib/requestError';
import { formatPauseEnd, pauseEndError, setTimeDefault, tonightOnlyEnd } from './pauseTimes';

type Choice = 'tonight' | 'until' | 'resume';
// The datetime-local input's value, read as wall-clock time in the Pod timezone.
const INPUT_FORMAT = 'YYYY-MM-DDTHH:mm';
// Some browsers add seconds; the pause always ends on a whole minute.
const INPUT_FORMATS = [`${INPUT_FORMAT}:ss.SSS`, `${INPUT_FORMAT}:ss`, INPUT_FORMAT];

export default function PauseScheduleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { side } = useAppStore();
  const { data: settings, refetch } = useSettings();
  const { data: schedules } = useSchedules();
  const timeZone = settings?.timeZone ?? 'UTC';
  const schedule = schedules?.[side];
  const [choice, setChoice] = useState<Choice>('tonight');
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!settings || !schedule) return null;
  const now = moment.tz(timeZone);
  const tonightEnd = tonightOnlyEnd(schedule, timeZone, now);
  const untilLocal = picked ?? setTimeDefault(schedule, timeZone, now).format(INPUT_FORMAT);
  const untilEnd = moment.tz(untilLocal, INPUT_FORMATS, true, timeZone).startOf('minute');
  const untilError = choice !== 'until' ? null : untilEnd.isValid() ? pauseEndError(untilEnd, now) : 'Pick a date and time';
  const other = side === 'left' ? 'right' : 'left';
  const name = settings[side].name || (side === 'left' ? 'Left side' : 'Right side');
  const partner = settings[other].name || (other === 'left' ? 'Left side' : 'Right side');

  // A save in flight cannot be cancelled, so closing waits for it.
  const close = () => {
    if (!saving) onClose();
  };

  const pause = async () => {
    // aria-disabled keeps focus on the button, so it does not block the click itself.
    if (saving || untilError) return;
    const expiresAt = choice === 'tonight' ? tonightEnd.format() : choice === 'until' ? untilEnd.format() : '';
    setSaving(true);
    setError('');
    try {
      await postSettings({ [side]: { scheduleOverrides: { pause: { active: true, expiresAt } } } });
      await refetch();
      onClose();
    } catch (err) {
      console.error(err);
      setError(serverMessage(err) ?? 'Could not pause the schedule. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      anchor="bottom"
      open={ open }
      onClose={ close }
      slotProps={ { paper: { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'pause-schedule-title' } } }>
      <Box sx={ { p: 3, width: '100%', maxWidth: 720, mx: 'auto' } }>
        <Typography variant="h2" id="pause-schedule-title">Pause <bdi>{ name }</bdi>'s schedule</Typography>
        <RadioGroup
          aria-labelledby="pause-schedule-title"
          value={ choice }
          onChange={ (_event, value) => {
            setChoice(value as Choice);
            setError('');
          } }
          sx={ { my: 2 } }>
          <FormControlLabel
            value="tonight"
            control={ <Radio autoFocus/> }
            label={ <Box>
              <Typography>Tonight only</Typography>
              <Typography variant="caption" color="text.secondary">
                { `until ${formatPauseEnd(tonightEnd, timeZone, now)}` }
              </Typography>
            </Box> }
            sx={ { minHeight: 44 } }/>
          <FormControlLabel value="until" control={ <Radio/> } label="Until a set time" sx={ { minHeight: 44 } }/>
          { choice === 'until' && <TextField
            type="datetime-local"
            label="Resume at"
            variant="standard"
            value={ untilLocal }
            onChange={ event => setPicked(event.target.value) }
            error={ !!untilError }
            helperText={ untilError ?? `Timezone: ${friendlyTimeZone(timeZone)}` }
            slotProps={ { inputLabel: { shrink: true } } }
            sx={ { ml: 4, mb: 1, maxWidth: 'calc(100% - 32px)' } }/> }
          <FormControlLabel value="resume" control={ <Radio/> } label="Until I resume" sx={ { minHeight: 44 } }/>
        </RadioGroup>
        <Typography variant="body2" color="text.secondary">
          Your saved schedule is kept.
          { !settings[other].awayMode && <> <bdi>{ partner }</bdi>'s side is not affected.</> }
        </Typography>
        { error && <Alert severity="error" sx={ { mt: 2 } }>{ error }</Alert> }
        <Box sx={ { display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 } }>
          <Button onClick={ close } aria-disabled={ saving || undefined } sx={ { minHeight: 44 } }>Cancel</Button>
          { /* aria-disabled while saving, so keyboard focus stays on the button */ }
          <Button
            variant="contained"
            onClick={ pause }
            disabled={ !!untilError }
            aria-disabled={ saving || undefined }
            sx={ { minHeight: 44, ...(saving ? { opacity: 0.6 } : {}) } }>
            Pause
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}
