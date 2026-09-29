import { Switch } from '@mui/material';
import { useScheduleStore } from './scheduleStore.tsx';
import { useAppStore } from '@state/appStore.tsx';

export default function EnabledSwitch() {
  const { isUpdating } = useAppStore();
  const { selectedSchedule, updateSelectedSchedule } = useScheduleStore();

  return <Switch
    slotProps={ { input: { 'aria-label': 'Enabled' } } }
    sx={ { flexShrink: 0 } }
    checked={ selectedSchedule?.power.enabled || false }
    onChange={ () => updateSelectedSchedule({ power: { enabled: !selectedSchedule?.power.enabled } }) }
    disabled={ isUpdating }/>;
}
