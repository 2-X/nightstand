import { Alert, Box, Button, Typography } from '@mui/material';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { Version } from '@api/deviceStatusSchema';
import RebootButton from './RebootButton.tsx';

export default function DeviceInfo() {
  const { data: deviceStatus, isLoading, isError, refetch } = useDeviceStatus();
  if (isError) return <Alert severity="warning" action={ <Button onClick={ () => void refetch() }>Retry</Button> }>
    Could not load device information.
  </Alert>;
  if (isLoading || !deviceStatus) return null;
  const hardware = [
    deviceStatus.coverVersion !== Version.NotFound && `${deviceStatus.coverVersion} Cover`,
    deviceStatus.hubVersion !== Version.NotFound && `${deviceStatus.hubVersion} Hub`,
  ].filter(Boolean).join(', ');
  const strength = deviceStatus.wifiStrength;
  const quality = strength < 40 ? 'Weak' : strength < 70 ? 'Fair' : 'Strong';
  return <Box sx={ { display: 'flex', flexDirection: 'column', gap: 2 } }>
    { hardware && <Box sx={ { display: 'flex', justifyContent: 'space-between', gap: 2 } }>
      <Typography>Hardware</Typography><Typography color="text.secondary">{ hardware }</Typography>
    </Box> }
    { strength > 0 && <Box sx={ { display: 'flex', justifyContent: 'space-between', gap: 2 } }>
      <Typography>Wi-Fi</Typography><Typography color="text.secondary">{ quality }, { strength }%</Typography>
    </Box> }
    <RebootButton />
  </Box>;
}
