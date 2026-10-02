import { Button } from '@mui/material';
import { postDeviceStatus } from '@api/deviceStatus.ts';
import { DeviceStatus } from '@api/deviceStatusSchema.ts';
import { DeepPartial } from 'ts-essentials';
import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { useSchedules } from '@api/schedules.ts';
import { getScheduledTargetTemperature } from '@lib/scheduleTemperature.ts';
import { useControlTempStore } from './controlTempStore.tsx';
import { scheduledTemperatureFromSleeps } from './sleepEvents';
import { useBedSleeps } from './useBedSleeps';
import { bedCommandMessage } from '@lib/requestError.ts';
import { powerPillSx } from './powerPill';


export type PowerButtonProps = {
  isOn: boolean;
  refetch: any;
}

export default function PowerButton({ isOn, refetch }: PowerButtonProps) {
  const { isUpdating, setIsUpdating, side } = useAppStore();
  const { data: settings } = useSettings();
  const { data: schedules } = useSchedules();
  const bed = useBedSleeps(side);
  const setDeviceStatus = useControlTempStore(state => state.setDeviceStatus);
  const beginEdit = useControlTempStore(state => state.beginEdit);
  const endEdit = useControlTempStore(state => state.endEdit);
  const markPoweredOff = useControlTempStore(state => state.markPoweredOff);
  const clearPoweredOff = useControlTempStore(state => state.clearPoweredOff);
  const setCommandError = useControlTempStore(state => state.setCommandError);
  const isInAwayMode = settings?.[side]?.awayMode;

  const handleOnClick = (powerOn: boolean) => {
    // Powering on manually starts at the temperature the schedule would have
    // the side at right now (or its upcoming power-on temperature), instead
    // of whatever target was left over from the last session.
    const scheduledTargetTemperature = !powerOn ? undefined
      : bed.state === 'rhythms' ? scheduledTemperatureFromSleeps(bed.sleeps, new Date())
        : bed.state === 'legacy' ? getScheduledTargetTemperature(schedules?.[side], settings?.timeZone ?? undefined) : undefined;
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
        setCommandError(undefined);
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
        if (!saved) setCommandError(bedCommandMessage(error));
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

  if (isInAwayMode) return null;

  // aria-disabled, not disabled, so a click does not drop focus to the page while it saves.
  return (
    <Button
      aria-disabled={ isUpdating || undefined }
      onClick={ () => { if (!isUpdating) handleOnClick(!isOn); } }
      sx={ powerPillSx(isOn ? 'off' : 'on') }>
      { isOn ? 'Turn off' : 'Turn on' }
    </Button>
  );
}
