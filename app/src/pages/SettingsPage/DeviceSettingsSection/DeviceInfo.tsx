import { Box, Chip } from '@mui/material';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { Version } from '@api/deviceStatusSchema';

export default function DeviceInfo() {
  const { data: deviceStatus, isLoading } = useDeviceStatus();
  if (isLoading || !deviceStatus) return null;
  const hideCover = deviceStatus.coverVersion === Version.NotFound;
  const hideHub = deviceStatus.hubVersion === Version.NotFound;
  return (
    <Box sx={ { display: 'flex', gap: 1 } }>
      {
        !hideCover && <Chip label={ `${deviceStatus.coverVersion} Cover` } />
      }
      {
        !hideHub && <Chip label={ `${deviceStatus.hubVersion} Hub` } />
      }
    </Box>
  );
}
