import Box from '@mui/material/Box';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';
import { useAppStore } from '@state/appStore.tsx';
import { useScheduleStore } from '../scheduleStore.tsx';
import { withCurrentValue } from '@lib/selectOptions.ts';
import _ from 'lodash';

const DURATION_LIST = _.range(10, 310, 10);

export default function AlarmDuration() {
  const { isUpdating } = useAppStore();
  const { selectedAlarmIndex, getEditedAlarms, updateSelectedAlarm } = useScheduleStore();
  const alarm = getEditedAlarms()[selectedAlarmIndex];
  const durations = withCurrentValue(DURATION_LIST, alarm?.duration);

  return (
    <Box sx={ { width: '100%' } }>
      <FormControl fullWidth>
        <InputLabel>Alarm Duration (seconds)</InputLabel>
        <Select
          disabled={ isUpdating }
          value={ alarm?.duration }
          variant='standard'
          onChange={ (event) => {
            updateSelectedAlarm({ duration: event.target.value as number });
          } }
        >
          {
            durations.map((duration) => (
              <MenuItem value={ duration } key={ duration }>{ duration }</MenuItem>
            ))
          }
        </Select>
      </FormControl>
    </Box>
  );
}
