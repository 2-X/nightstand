import { Box, Slider, Typography } from '@mui/material';
import { useScheduleStore } from '../scheduleStore.tsx';
import { useAppStore } from '@state/appStore.tsx';
import { useTheme } from '@mui/material/styles';

export default function AlarmVibrationSlider() {
  const { isUpdating } = useAppStore();
  const { selectedAlarmIndex, getEditedAlarms, updateSelectedAlarm } = useScheduleStore();
  const alarm = getEditedAlarms()[selectedAlarmIndex];
  const theme = useTheme();

  return (
    <Box sx={ { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, flex: 1, pr: 1 } }>
      <Typography sx={ { mb: 0, textAlign: 'center' } } variant="body2" color={ theme.palette.grey[200] }>
        { `Vibration intensity ${alarm?.vibrationIntensity}%` }
      </Typography>

      <Slider
        value={ alarm?.vibrationIntensity || 50 }
        onChange={ (_, newValue) => {
          updateSelectedAlarm({ vibrationIntensity: newValue as number });
        } }
        min={ 1 }
        max={ 100 }
        step={ 1 }
        marks={ [
          { value: 1, label: '1' },
          { value: 50, label: '50' },
          { value: 100, label: '100' },
        ] }
        disabled={ isUpdating }
        sx={ { width: '100%', mb: 2 } }
      />
    </Box>
  );
}
