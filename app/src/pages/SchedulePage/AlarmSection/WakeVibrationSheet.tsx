import { Box, Button, Dialog, DialogContent, DialogTitle, MenuItem, Slider, Stack, TextField, Typography } from '@mui/material';
import { useScheduleStore } from '../scheduleStore';
import { useAppStore } from '@state/appStore';
import AlarmTest from './AlarmTest';

export default function WakeVibrationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useScheduleStore();
  const disabled = useAppStore(state => state.isUpdating);
  const alarm = store.getEditedAlarms()[store.selectedAlarmIndex];
  if (!alarm) return null;
  const durations = [...new Set([alarm.duration, ...Array.from({ length: 30 }, (_, index) => (index + 1) * 10)])]
    .sort((first, second) => first - second);
  return <Dialog
    open={ open }
    onClose={ onClose }
    aria-labelledby="wake-vibration-title"
    fullWidth
    maxWidth="sm"
    sx={ { '& .MuiDialog-container': { alignItems: 'flex-end' },
      '& .MuiDialog-paper': { m: 0, width: '100%', borderRadius: '20px 20px 0 0' } } }>
    <DialogTitle id="wake-vibration-title">Wake-up vibration</DialogTitle>
    <DialogContent><Stack spacing={ 3 } sx={ { pt: 1 } }>
      <TextField
        select
        label="Pattern"
        value={ alarm.vibrationPattern }
        disabled={ disabled }
        onChange={ event => store.updateSelectedAlarm({ vibrationPattern: event.target.value as 'rise' | 'double' }) }>
        <MenuItem value="rise">Builds up</MenuItem><MenuItem value="double">Double pulse</MenuItem>
      </TextField>
      <Box sx={ { px: 1 } }><Typography id="vibration-strength">Strength { alarm.vibrationIntensity } of 100</Typography>
        <Slider
          aria-labelledby="vibration-strength"
          min={ 1 }
          max={ 100 }
          value={ alarm.vibrationIntensity }
          disabled={ disabled }
          onChange={ (_, value) => store.updateSelectedAlarm({ vibrationIntensity: value as number }) }/></Box>
      <TextField
        select
        label="Length"
        value={ alarm.duration }
        disabled={ disabled }
        onChange={ event => store.updateSelectedAlarm({ duration: Number(event.target.value) }) }>
        { durations.map(duration => <MenuItem key={ duration } value={ duration }>{ duration % 60 === 0 && duration > 0
          ? `${duration / 60} ${duration === 60 ? 'minute' : 'minutes'}` : `${duration} seconds` }</MenuItem>) }
      </TextField>
      <AlarmTest/>
      <Button onClick={ onClose }>Done</Button>
    </Stack></DialogContent>
  </Dialog>;
}
