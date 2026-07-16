import { Alert, AlertTitle, Box, Chip, Typography } from '@mui/material';
import { useServerInfo } from '@api/serverInfo.ts';
import { useRollbackInfo } from '@api/update.ts';
import currentServerInfo from '../../../server/src/serverInfo.json';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import UpdateFreeSleepButton from '../pages/SettingsPage/DeviceSettingsSection/UpdateFreeSleepButton.tsx';
import RollbackRow from '../pages/SettingsPage/VersionsPage/RollbackRow.tsx';
import RevertToStockRow from '../pages/SettingsPage/VersionsPage/RevertToStockRow.tsx';


export default function VersionStatus() {
  const { data: serverInfo, isLoading, isError } = useServerInfo();
  const { data: rollbackInfo } = useRollbackInfo();
  if (isError || isLoading) return null;

  return (
    <>
      {
        serverInfo?.updateAvailable && (
          <>
            <Alert severity="info">
              <AlertTitle>
                Nightstand update available!
              </AlertTitle>
              <Typography variant="body2">
                Latest version: { serverInfo.version }
              </Typography>
              <Typography variant="body2" sx={ { mb: 1 } }>
                Current version: { currentServerInfo.version }
              </Typography>
              <UpdateFreeSleepButton runningVersion={ currentServerInfo.version }/>
            </Alert>
          </>
        )
      }
      {
        !serverInfo?.updateAvailable && (
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
        <RollbackRow runningVersion={ currentServerInfo.version } rollbackVersion={ rollbackInfo.version }/>
      ) }
      <Box sx={ { mt: 1 } }>
        <RevertToStockRow runningVersion={ currentServerInfo.version }/>
      </Box>
    </>
  );
}
