import { Switch } from '@mui/material';
import { useScheduleStore } from './scheduleStore.tsx';
import { useAppStore } from '@state/appStore.tsx';

export default function EnabledSwitch() {
  const { isUpdating } = useAppStore();
  const { selectedSchedule, selectedDay, updateSelectedSchedule } = useScheduleStore();
  const night = `${selectedDay.charAt(0).toUpperCase()}${selectedDay.slice(1)} night`;

  return <Switch
    slotProps={ { input: { 'aria-label': `Schedule ${night}` } } }
    sx={ { flexShrink: 0 } }
    checked={ selectedSchedule?.power.enabled || false }
    onChange={ () => updateSelectedSchedule({ power: { enabled: !selectedSchedule?.power.enabled } }) }
    disabled={ isUpdating }/>;
}
