import Box from '@mui/material/Box';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';
import { useAppStore } from '@state/appStore.tsx';
import { useScheduleStore } from '../scheduleStore.tsx';


const PATTERNS = ['rise', 'double'];
export default function AlarmPattern() {
  const { isUpdating } = useAppStore();
  const { selectedAlarmIndex, getEditedAlarms, updateSelectedAlarm } = useScheduleStore();
  const alarm = getEditedAlarms()[selectedAlarmIndex];

  return (
    <Box sx={ { minWidth: 120 } }>
      <FormControl fullWidth>
        <InputLabel>Vibration pattern</InputLabel>
        <Select
          disabled={ isUpdating }
          value={ alarm?.vibrationPattern }
          variant='standard'
          onChange={ (event) => {
            updateSelectedAlarm({ vibrationPattern: event.target.value as 'rise' | 'double' });
          } }
        >
          {
            PATTERNS.map((pattern) => (
              <MenuItem value={ pattern } key={ pattern }>{ pattern }</MenuItem>
            ))
          }
        </Select>
      </FormControl>
    </Box>
  );
}
