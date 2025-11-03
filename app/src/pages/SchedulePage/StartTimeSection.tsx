import { Box, Slider, TextField, Typography } from '@mui/material';
import { useAppStore } from '@state/appStore.tsx';
import { useScheduleStore } from './scheduleStore.tsx';
import { formatTemperature, getTemperatureColor, MAX_TEMP_F, MIN_TEMP_F } from '@lib/temperatureConversions.ts';


export default function StartTimeSection({ displayCelsius }: { displayCelsius: boolean }) {
  const { isUpdating } = useAppStore();
  const { selectedSchedule, updateSelectedSchedule } = useScheduleStore();

  const disabled = !selectedSchedule?.power.enabled || isUpdating;
  const onTemperatureValue = selectedSchedule?.power?.onTemperature || 82;
  return (
    <Box sx={ { display: 'flex', alignItems: 'center', gap: 6, p: 0, width: '100%' } } id="start-time-section">
      { /* Start time */ }
      <TextField
        label="Power on"
        type="time"
        variant='standard'
        value={ selectedSchedule?.power.on || '21:00' }
        disabled={ disabled }
        onChange={ (event) => {
          updateSelectedSchedule({
            power: {
              on: event.target.value,
            }
          });
        } }
        sx={ { width: '150px' } }
      />

      { /* Temperature slider */ }
      <Box sx={ { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, flex: 1, pr: 1 } }>
        { /* Temperature label */ }
        <Typography sx={ { mb: -1, textAlign: 'center' } }>
          { `Power on temperature ${formatTemperature(selectedSchedule?.power?.onTemperature || 82, displayCelsius)}` }
        </Typography>
        <Slider
          value={ onTemperatureValue }

          onChange={ (_, newValue) => {
            updateSelectedSchedule({
              power: {
                // @ts-ignore
                onTemperature: newValue
              }
            });
          } }
          min={ MIN_TEMP_F }
          max={ MAX_TEMP_F }
          step={ 1 }
          marks={ [
            { value: MIN_TEMP_F, label: formatTemperature(MIN_TEMP_F, displayCelsius) },
            { value: MAX_TEMP_F, label: formatTemperature(MAX_TEMP_F, displayCelsius) },
          ] }
          disabled={ disabled }
          sx={ {
            color: getTemperatureColor(onTemperatureValue), // red track and thumb
            width: '100%',
          } }
        />
      </Box>
    </Box>
  );
}
