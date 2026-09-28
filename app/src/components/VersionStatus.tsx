import { Alert, AlertTitle, Box, Chip, Typography } from '@mui/material';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { useLatestVersion } from '@api/useLatestVersion.ts';
import semver from 'semver';
import { useRollbackInfo } from '@api/update.ts';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import UpdateFreeSleepButton from '../pages/SettingsPage/DeviceSettingsSection/UpdateFreeSleepButton.tsx';
import RollbackRow from '../pages/SettingsPage/VersionsPage/RollbackRow.tsx';
import RevertToStockRow from '../pages/SettingsPage/VersionsPage/RevertToStockRow.tsx';


export default function VersionStatus() {
  const { data: deviceStatus, isLoading, isError } = useDeviceStatus();
  const latestVersion = useLatestVersion();
  const runningVersion = deviceStatus?.freeSleep?.version;
  const known = !!latestVersion && !!runningVersion && !!semver.valid(latestVersion) && !!semver.valid(runningVersion);
  const updateAvailable = known && semver.gt(latestVersion, runningVersion);
  const { data: rollbackInfo } = useRollbackInfo();
  if (isError || isLoading || !runningVersion) return null;

  return (
    <>
      {
        updateAvailable && (
          <>
            <Alert severity="info">
              <AlertTitle>
                Nightstand update available!
              </AlertTitle>
              <Typography variant="body2">
                Latest version: { latestVersion }
              </Typography>
              <Typography variant="body2" sx={ { mb: 1 } }>
                Current version: { runningVersion }
              </Typography>
              <UpdateFreeSleepButton runningVersion={ runningVersion }/>
            </Alert>
          </>
        )
      }
      {
        known && !updateAvailable && (
          <Chip
            icon={ <CheckCircleIcon/> }
            label="Up to date"
            color="success"
            variant="filled"
            size="small"
            sx={ {
              minWidth: '112px',
              width: 'fit-content',
              '.MuiChip-label': {
                overflow: 'visible',
              },
            } }
          />
        )
      }
      { rollbackInfo?.available && rollbackInfo.version && (
        <RollbackRow runningVersion={ runningVersion } rollbackVersion={ rollbackInfo.version }/>
      ) }
      <Box sx={ { mt: 1 } }>
        <RevertToStockRow runningVersion={ runningVersion }/>
      </Box>
    </>
  );
}
