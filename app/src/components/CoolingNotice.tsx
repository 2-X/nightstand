import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useSettings } from '@api/settings';
import { useFirmware } from '@api/firmware';
import axios from '@api/api';

export default function CoolingNotice() {
  const { data: settings } = useSettings();
  const enabled = settings?.features?.coolingWarning === true;
  const query = useFirmware(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const side = (['left', 'right'] as const).find(candidate => query.data?.cooling[candidate]?.notice);
  const finding = side ? query.data?.cooling[side] : undefined;
  if (!enabled || !side || !finding || query.isError || query.data?.availability === 'Monitoring unavailable') return null;
  const acknowledge = async () => {
    setBusy(true); setError(false);
    try {
      await axios.post('/services/firmware/cooling/acknowledge', { side, since: finding.since });
      await query.refetch();
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  return <Dialog open disableEscapeKeyDown aria-labelledby="cooling-notice-title">
    <DialogTitle id="cooling-notice-title">Water is warming while cooling is requested</DialogTitle>
    <DialogContent>
      <Typography>{ side === 'left' ? 'Left' : 'Right' } side. This is a sensor observation. Check System status for details.</Typography>
      { error && <Alert severity="warning">Could not acknowledge this notice. Try again.</Alert> }
    </DialogContent>
    <DialogActions><Button disabled={ busy } onClick={ () => void acknowledge() }>Acknowledge</Button></DialogActions>
  </Dialog>;
}
