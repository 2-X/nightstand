import SearchIcon from '@mui/icons-material/Search';
import Button from '@mui/material/Button';
import { postDeviceStatus } from '@api/deviceStatus.ts';
import { DeviceStatus, SideStatus, } from '@api/deviceStatusSchema.ts';
import { DeepPartial } from 'ts-essentials';
import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { useState } from 'react';
import { useServices } from '@api/services.ts';
import { Job, postJobs } from '@api/jobs.ts';
import AnalyzeSleepNotification from './AnalyzeSleepNotification.tsx';


type PowerButtonProps = {
  isOn: boolean;
  refetch: any;
}

export default function PowerButton({ isOn, refetch }: PowerButtonProps) {
  const { isUpdating, setIsUpdating, side } = useAppStore();
  const { data: settings } = useSettings();
  const { data: services } = useServices();
  const isInAwayMode = settings?.[side].awayMode;
  const disabled = isUpdating || isInAwayMode;
  const [showAnalyzeSleep, setShowAnalyzeSleep] = useState(false);
  const [showAnalyzeNotification, setShowAnalyzeNotification] = useState(false);

  const handleOnClick = () => {
    const sideStatus: Partial<SideStatus> = { isOn: !isOn };
    const deviceStatus: DeepPartial<DeviceStatus> = {};

    deviceStatus[side] = sideStatus;
    if (isOn) {
      setShowAnalyzeSleep(true);
      setTimeout(() => setShowAnalyzeSleep(false), 20_000);

    } else {
      setShowAnalyzeSleep(false);
    }

    setIsUpdating(true);
    postDeviceStatus(deviceStatus)
      .then(() => {
        // Wait 1 second before refreshing the device status
        return new Promise((resolve) => setTimeout(resolve, 1_000));
      })
      .then(() => refetch())
      .catch(error => {
        console.error(error);
      })
      .finally(() => {
        setIsUpdating(false);
      });
  };

  const handleAnalyzeSleep = () => {
    const capitalized = side.charAt(0).toUpperCase() + side.slice(1) as Job;
    setShowAnalyzeNotification(true);
    // @ts-expect-error
    postJobs([`analyzeSleep${capitalized}`])
      .catch(error => {
        console.error(error);
      });
    setTimeout(() => setShowAnalyzeNotification(false), 120_000);
  };
  if (isInAwayMode) return null;

  return (
    <>
      <Button variant="outlined" disabled={ disabled } onClick={ handleOnClick }>
        { isOn ? 'Turn off' : 'Turn on' }
      </Button>
      {
        showAnalyzeSleep && !isUpdating && services?.biometrics?.enabled && (
          <Button
            variant="contained"
            disabled={ disabled }
            onClick={ handleAnalyzeSleep }
          >
            <SearchIcon />
            Analyze sleep
          </Button>
        )
      }
      {
        showAnalyzeNotification && (
          <AnalyzeSleepNotification />
        )
      }
    </>
  );
}
