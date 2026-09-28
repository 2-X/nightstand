import { useEffect, useState } from 'react';
import {
  Alert,
  Dialog,
  DialogActions,
  DialogTitle,
  Button,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useAppStore } from '@state/appStore.tsx';
import AlarmIcon from '@mui/icons-material/Alarm';
import { keyframes } from '@mui/system';
import { postDeviceStatus } from '@api/deviceStatus.ts';
import { useControlTempStore } from './controlTempStore.tsx';


type AlarmDismissalProps = {
  refetch: () => Promise<unknown>;
}

const pulse = keyframes`
    0% { transform: scale(1) translateX(0); }
    10% { transform: scale(1.1) translateX(-3px); }
    20% { transform: scale(1.1) translateX(3px); }
    30% { transform: scale(1.1) translateX(-3px); }
    40% { transform: scale(1.1) translateX(3px); }
    50% { transform: scale(1.2) translateX(0); }
    100% { transform: scale(1) translateX(0); }
`;


export default function AlarmDismissal({ refetch }: AlarmDismissalProps) {
  const { side, setIsUpdating, isUpdating } = useAppStore();
  const deviceStatus = useControlTempStore(state => state.deviceStatus);

  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState('');
  const isAlarmVibrating = deviceStatus?.[side]?.isAlarmVibrating || false;

  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));

  // Clear the one-shot dismiss latch once the pod confirms the alarm has
  // stopped, so the next alarm re-opens the dialog. Without this, `dismissed`
  // stays true for the life of the mounted page and every alarm after the
  // first vibrates with no dismissal UI.
  useEffect(() => {
    if (!isAlarmVibrating) setDismissed(false);
  }, [isAlarmVibrating]);


  const handleDismiss = () => {
    setError('');
    setIsUpdating(true);
    postDeviceStatus({
      [side]: {
        isAlarmVibrating: false,
      }
    })
      .then(() => {
        // Wait 1 second before refreshing the device status
        return new Promise((resolve) => setTimeout(resolve, 1_000));
      })
      .then(() => refetch())
      .then(() => {
        // Only hide the dialog once the dismiss actually succeeded. Marking it
        // dismissed unconditionally would close it on a failed dismiss while
        // the pod may still be vibrating.
        setDismissed(true);
      })
      .catch(error => {
        console.error(error);
        setError('Could not dismiss the alarm. Try again.');
      })
      .finally(() => {
        setIsUpdating(false);
      });
  };

  return (
    <Dialog
      open={ dismissed ? false : isAlarmVibrating }
      fullScreen={ false }
      fullWidth
      maxWidth="xs"
      aria-labelledby="active-alarm-title"
      PaperProps={ { sx: { p: isSmallScreen ? 2 : 3 } } }
    >
      <DialogTitle id="active-alarm-title">{ side === 'left' ? 'Left' : 'Right' } side alarm</DialogTitle>
      <DialogActions
        sx={ {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
        } }
      >
        <AlarmIcon
          fontSize="large"
          sx={ {
            mb: 2, animation: `${pulse} 2s infinite`, '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          } }/>
        { error && <Alert severity="error">{ error }</Alert> }
        <Button
          onClick={ handleDismiss }
          disabled={ isUpdating }
          color="error"
          variant="contained"
        >
          Dismiss Alarm
        </Button>
      </DialogActions>
    </Dialog>
  );
}
