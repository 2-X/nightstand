import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import { postJobs } from '@api/jobs.ts';

export default function RebootButton() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState(false);
  const restart = async () => {
    setPending(true);
    setError(false);
    try {
      await postJobs(['reboot']);
      setRequested(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return <>
    <Button variant="outlined" size="small" onClick={ () => { setOpen(true); setError(false); setRequested(false); } }>Restart Pod</Button>
    <Dialog open={ open } onClose={ () => !pending && setOpen(false) } aria-labelledby="restart-title" fullWidth maxWidth="xs">
      <DialogTitle id="restart-title">Restart Pod?</DialogTitle>
      <DialogContent>
        <Typography>
          The app, schedules and alarms pause while the Pod restarts. Takes about a minute.
          Wait for it to reconnect before sending more commands.
        </Typography>
        { requested && <Typography role="status" sx={ { mt: 2 } }>Restart requested. Completion has not been confirmed.</Typography> }
        { error && <Alert severity="error" sx={ { mt: 2 } }>Could not confirm the restart. Check System status before retrying.</Alert> }
        { (requested || error) && <Button component={ Link } to="/settings/system">System status</Button> }
      </DialogContent>
      <DialogActions>
        <Button disabled={ pending } onClick={ () => setOpen(false) }>{ requested ? 'Close' : 'Cancel' }</Button>
        { !requested && <Button variant="contained" disabled={ pending } onClick={ () => void restart() }>
          { pending ? 'Requesting restart...' : 'Restart Pod' }
        </Button> }
      </DialogActions>
    </Dialog>
  </>;
}
