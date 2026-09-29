import { Alert, Button, Box } from '@mui/material';
import { postDeviceStatus } from '@api/deviceStatus.ts';
import { DeviceStatus } from '@api/deviceStatusSchema.ts';
import { DeepPartial } from 'ts-essentials';
import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { useState } from 'react';
import useAnalyzeSleep from '@lib/useAnalyzeSleep';
import { useSchedules } from '@api/schedules.ts';
import { getScheduledTargetTemperature } from '@lib/scheduleTemperature.ts';
import AnalyzeSleepNotification from './AnalyzeSleepNotification.tsx';
import { useControlTempStore } from './controlTempStore.tsx';


type PowerButtonProps = {
  isOn: boolean;
  refetch: any;
}

export default function PowerButton({ isOn, refetch }: PowerButtonProps) {
  const { isUpdating, setIsUpdating, side } = useAppStore();
  const { data: settings } = useSettings();
  const { analyze, canAnalyze, isPending: analyzing, error: analysisError } = useAnalyzeSleep();
  const { data: schedules } = useSchedules();
  const setDeviceStatus = useControlTempStore(state => state.setDeviceStatus);
  const beginEdit = useControlTempStore(state => state.beginEdit);
  const endEdit = useControlTempStore(state => state.endEdit);
  const isInAwayMode = settings?.[side]?.awayMode;
  const disabled = isUpdating || isInAwayMode;
  const [showAnalyzeSleep, setShowAnalyzeSleep] = useState(false);

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
    if (powerOn) {
      setShowAnalyzeSleep(false);
    } else {
      setShowAnalyzeSleep(true);
      setTimeout(() => setShowAnalyzeSleep(false), 20_000);
    }

    setIsUpdating(true);
    let gateOpen = true;
    beginEdit();
    setDeviceStatus(deviceStatus);
    postDeviceStatus(deviceStatus)
      .then(() => {
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
      })
      .finally(() => {
        setIsUpdating(false);
      });
  };

  if (isInAwayMode) return null;

  return (
    <Box sx={ { width: '100%', mt: 0, display: 'flex', flexDirection: 'column', gap: 2 } }>
      <Button fullWidth variant="outlined" disabled={ disabled } onClick={ () => handleOnClick(!isOn) }>
        { isOn ? 'Turn off' : 'Turn on' }
      </Button>
      {
        showAnalyzeSleep && !isUpdating && canAnalyze && (
          <Button
            variant="text"
            disabled={ !canAnalyze }
            onClick={ () => void analyze() }
          >
            Analyze last night
          </Button>
        )
      }
      { analysisError && <Alert severity="error">Could not start sleep analysis. Try again.</Alert> }
      {
        analyzing && (
          <AnalyzeSleepNotification />
        )
      }
    </Box>
  );
}
