import { FormControlLabel, Switch } from '@mui/material';
import { useScheduleStore } from '../scheduleStore.tsx';
import { useAppStore } from '@state/appStore.tsx';


export default function AlarmEnabledSwitch() {
  const { isUpdating } = useAppStore();
  const { selectedAlarmIndex, getEditedAlarms, updateSelectedAlarm } = useScheduleStore();
  const alarm = getEditedAlarms()[selectedAlarmIndex];

  return (
    <FormControlLabel
      control={
        <Switch
          checked={ alarm?.enabled || false }
          onChange={ () => {
            updateSelectedAlarm({ enabled: !alarm?.enabled });
          } }
          disabled={ isUpdating }
        />
      }
      label="Enabled"
    />
  );
}
