import { Alert, AlertTitle, Typography } from '@mui/material';
import { useServerInfo } from '@api/serverInfo.ts';
import currentServerInfo from '../../../server/src/serverInfo.json';

export default function UpdateAvailable() {
  const { data: serverInfo, isLoading, isError } = useServerInfo();
  if (isError || isLoading || !serverInfo?.updateAvailable) return null;

  return (
    <>
      <br/>
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
    </>
  );
}
