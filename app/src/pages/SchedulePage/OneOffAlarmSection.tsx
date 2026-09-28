import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AlarmOnIcon from '@mui/icons-material/AlarmOn';
import moment from 'moment-timezone';

import GlassCard from '@design/GlassCard';
import { palette } from '@design/tokens';
import { postSettings, useSettings } from '@api/settings.ts';
import { useAppStore } from '@state/appStore.tsx';

const PATTERNS = ['rise', 'double'] as const;
type Pattern = 'rise' | 'double';

// HTML <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" with no offset.
// We treat that string as wall-clock time in the user's timezone.
function isoToLocalInput(iso: string, tz: string): string {
  if (!iso) return '';
  const m = moment.tz(iso, tz);
  return m.isValid() ? m.format('YYYY-MM-DDTHH:mm') : '';
}

function localInputToIso(localStr: string, tz: string): string {
  if (!localStr) return '';
  const m = moment.tz(localStr, 'YYYY-MM-DDTHH:mm', tz);
  return m.isValid() ? m.format() : '';
}

export default function OneOffAlarmSection() {
  const { side } = useAppStore();
  const { data: settings, refetch } = useSettings();

  const [enabled, setEnabled] = useState(false);
  const [fireAtLocal, setFireAtLocal] = useState('');
  const [intensity, setIntensity] = useState(100);
  const [pattern, setPattern] = useState<Pattern>('rise');
  const [duration, setDuration] = useState(30);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { setSaved(false); }, [enabled, fireAtLocal, intensity, pattern, duration, side]);

  // Sync from server when settings load or side changes.
  useEffect(() => {
    if (!settings) return;
    const o = settings[side]?.oneOffAlarm;
    if (!o) return;
    setEnabled(o.enabled);
    setFireAtLocal(isoToLocalInput(o.fireAt, settings.timeZone));
    setIntensity(o.vibrationIntensity);
    setPattern(o.vibrationPattern as Pattern);
    setDuration(o.duration);
  }, [settings, side]);

  if (!settings) return null;

  const fireAtIso = localInputToIso(fireAtLocal, settings.timeZone);
  const fireAtMoment = fireAtIso ? moment(fireAtIso) : null;
  const isInPast = !!fireAtMoment && fireAtMoment.isBefore(moment());

  const canSave =
    !saving &&
    (!enabled || (!!fireAtLocal && !isInPast));

  const handleSave = async () => {
    setSaveError('');
    setSaved(false);
    setSaving(true);
    try {
      await postSettings({
        [side]: {
          oneOffAlarm: {
            enabled,
            fireAt: fireAtIso,
            vibrationIntensity: intensity,
            vibrationPattern: pattern,
            duration,
          },
        },
      });
      await refetch();
      setSaved(true);
    } catch (err) {
      console.error(err);
      setSaveError('Could not save the one-time alarm. Your changes are still here. Try again.');
    } finally {
      setSaving(false);
    }
  };

  // Defaulting the picker to "tomorrow at the recurring alarm's time" would be
  // nicer, but a sane min is enough to prevent picking past times.
  const minLocal = moment.tz(settings.timeZone).add(1, 'minute').format('YYYY-MM-DDTHH:mm');

  return (
    <GlassCard>
      { saveError && <Alert severity="error">{ saveError }</Alert> }
      { saved && <Typography role="status" variant="body2">One-time alarm saved for the { side } side.</Typography> }
      <Box sx={ { display: 'flex', alignItems: 'center', gap: 1.25, mb: 2 } }>
        <AlarmOnIcon sx={ { color: palette.text.primary } } />
        <Typography sx={ { fontSize: '1.1rem', fontWeight: 600, color: palette.text.primary } }>
          One-time alarm
        </Typography>
      </Box>

      <Typography sx={ { color: palette.text.secondary, fontSize: '0.85rem', mb: 2 } }>
        Fires once for the { side } side, then disables itself. Saved separately from the recurring schedule.
      </Typography>

      <Box sx={ { display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 } }>
        <Typography sx={ { color: palette.text.primary } }>Enabled</Typography>
        <Switch
          slotProps={ { input: { 'aria-label': 'Enable one-time alarm' } } }
          checked={ enabled }
          onChange={ (e) => setEnabled(e.target.checked) } />
      </Box>

      { enabled && (
        <>
          <Box sx={ { mb: 2 } }>
            <TextField
              type="datetime-local"
              label="Fire at"
              fullWidth
              variant="standard"
              value={ fireAtLocal }
              onChange={ (e) => setFireAtLocal(e.target.value) }
              InputLabelProps={ { shrink: true } }
              inputProps={ { min: minLocal } }
              error={ isInPast }
              helperText={ isInPast ? 'Time is in the past' : `Timezone: ${settings.timeZone}` }
            />
          </Box>

          <Box sx={ { display: 'flex', gap: 2, mb: 2 } }>
            <TextField
              type="number"
              label="Duration (s)"
              variant="standard"
              value={ duration }
              onChange={ (e) => setDuration(Math.min(180, Math.max(0, Number(e.target.value) || 0))) }
              inputProps={ { min: 0, max: 180 } }
              sx={ { flex: 1 } }
            />
            <FormControl variant="standard" sx={ { flex: 1 } }>
              <InputLabel>Pattern</InputLabel>
              <Select value={ pattern } onChange={ (e) => setPattern(e.target.value as Pattern) }>
                { PATTERNS.map((p) => (
                  <MenuItem key={ p } value={ p }>{ p }</MenuItem>
                )) }
              </Select>
            </FormControl>
          </Box>

          <Box sx={ { px: 1, mb: 1 } }>
            <Typography sx={ { color: palette.text.secondary, fontSize: '0.85rem', mb: 1 } }>
              Vibration intensity: { intensity }%
            </Typography>
            <Slider
              value={ intensity }
              onChange={ (_e, v) => setIntensity(Array.isArray(v) ? v[0] : v) }
              min={ 1 }
              max={ 100 }
              step={ 1 }
            />
          </Box>
        </>
      ) }

      <Box sx={ { display: 'flex', justifyContent: 'flex-end', mt: 1 } }>
        <Button
          variant="contained"
          onClick={ handleSave }
          disabled={ !canSave }
          size="small"
        >
          { saving ? <CircularProgress size={ 18 } /> : 'Save one-time alarm' }
        </Button>
      </Box>
    </GlassCard>
  );
}
