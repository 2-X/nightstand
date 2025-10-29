import { Alert, AlertTitle, Chip, Typography } from '@mui/material';
import { useServerInfo } from '@api/serverInfo.ts';
import currentServerInfo from '../../../server/src/serverInfo.json';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

export default function VersionStatus() {
  const { data: serverInfo, isLoading, isError } = useServerInfo();
  if (isError || isLoading) return null;

  return (
    <>
      {
        serverInfo?.updateAvailable && (
          <Alert severity="info">
            <AlertTitle>
              Free-sleep update available!
            </AlertTitle>
            Latest version: { serverInfo.version }
            <br/>
            Current version: { currentServerInfo.version }
            <br/>
            SSH into your pod and run
            <br/>
            <Typography sx={ { fontFamily: 'monospace' } } variant="body2">
              sh /home/dac/free-sleep/scripts/update.sh
            </Typography>
          </Alert>
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
          />
        )
      }
    </>
  );
}
