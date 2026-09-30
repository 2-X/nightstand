import { Link } from 'react-router-dom';
import { Button, Box, Typography } from '@mui/material';
import { postDeviceStatus } from '@api/deviceStatus.ts';
import { DeviceStatus } from '@api/deviceStatusSchema.ts';
import { DeepPartial } from 'ts-essentials';
import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { useSchedules } from '@api/schedules.ts';
import { getScheduledTargetTemperature } from '@lib/scheduleTemperature.ts';
import { useControlTempStore } from './controlTempStore.tsx';


type PowerButtonProps = {
  isOn: boolean;
  refetch: any;
}

export default function PowerButton({ isOn, refetch }: PowerButtonProps) {
  const { isUpdating, setIsUpdating, side } = useAppStore();
  const { data: settings } = useSettings();
  const { data: schedules } = useSchedules();
  const setDeviceStatus = useControlTempStore(state => state.setDeviceStatus);
  const beginEdit = useControlTempStore(state => state.beginEdit);
  const endEdit = useControlTempStore(state => state.endEdit);
  const markPoweredOff = useControlTempStore(state => state.markPoweredOff);
  const clearPoweredOff = useControlTempStore(state => state.clearPoweredOff);
  const isInAwayMode = settings?.[side]?.awayMode;
  const disabled = isUpdating || isInAwayMode;

  const handleOnClick = (powerOn: boolean) => {
    // Powering on manually starts at the temperature the schedule would have
    // the side at right now (or its upcoming power-on temperature), instead
    // of whatever target was left over from the last session.
    const scheduledTargetTemperature = powerOn
      ? getScheduledTargetTemperature(schedules?.[side], settings?.timeZone ?? undefined)
      : undefined;
    if (scheduledTargetTemperature !== undefined && !Number.isFinite(scheduledTargetTemperature)) return;
    const deviceStatus: DeepPartial<DeviceStatus> = {
      [side]: {
        isOn: powerOn,
        ...(scheduledTargetTemperature === undefined ? {} : { targetTemperatureF: scheduledTargetTemperature }),
      }
    };

    setIsUpdating(true);
    let gateOpen = true;
    beginEdit();
    const previous = useControlTempStore.getState().deviceStatus?.[side];
    setDeviceStatus(deviceStatus);
    let saved = false;
    postDeviceStatus(deviceStatus)
      .then(() => {
        saved = true;
        if (powerOn) clearPoweredOff();
        else markPoweredOff(side);
        // Wait 1 second before refreshing the device status
        return new Promise((resolve) => setTimeout(resolve, 1_000));
      })
      .then(() => {
        if (gateOpen) {
          gateOpen = false;
          endEdit();
        }
        return refetch();
      })
      .then((data) => setDeviceStatus(data.data))
      .catch(error => {
        if (gateOpen) {
          gateOpen = false;
          endEdit();
        }
        console.error(error);
        // The write failed, so the optimistic power state is a lie; a target
        // set for Turn on goes back too.
        if (!saved && previous) {
          setDeviceStatus({ [side]: {
            isOn: previous.isOn,
            ...(powerOn ? { targetTemperatureF: previous.targetTemperatureF } : {}),
          } });
        }
      })
      .finally(() => {
        setIsUpdating(false);
      });
  };

  if (isInAwayMode) {
    return (
      <Typography variant="body2" color="text.secondary" sx={ { textAlign: 'center' } }>
        Away mode is on. Change it in <Link to="/settings/bed" style={ { color: 'inherit' } }>Settings, Bed and sides</Link>.
      </Typography>
    );
  }

  return (
    <Box sx={ { width: '100%', mt: 0, display: 'flex', flexDirection: 'column', gap: 2 } }>
      <Button fullWidth variant="outlined" disabled={ disabled } onClick={ () => handleOnClick(!isOn) }>
        { isOn ? 'Turn off' : 'Turn on' }
      </Button>
    </Box>
  );
}
