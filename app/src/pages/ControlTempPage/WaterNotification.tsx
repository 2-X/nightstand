import Alert from '@mui/material/Alert';
import { useDeviceStatus } from '@api/deviceStatus.ts';



export default function WaterNotification() {
  const { data: deviceStatus } = useDeviceStatus();

  if (deviceStatus?.waterLevel === 'false') {
    return (
      <Alert severity="warning">
        Water tank is low. Refill it to keep heating and cooling.
      </Alert>
    );
  }
  if (![undefined, 'true'].includes(deviceStatus?.waterLevel)) {
    return (
      <Alert severity="warning">
        Water level could not be read. Refresh to try again.
      </Alert>
    );
  }
  return null;

}

