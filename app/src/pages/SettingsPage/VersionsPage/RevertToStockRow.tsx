import { Link } from 'react-router-dom';
import { useState, useId } from 'react';
import {
  Alert, ButtonBase, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Stack, Typography,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { postRevertToStock } from '@api/update.ts';
import { useUpdateProgress } from '@api/useUpdateProgress.ts';

type Props = {
  runningVersion: string | undefined;
};

export default function RevertToStockRow({ runningVersion }: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const { phase, error, start, reset } = useUpdateProgress(runningVersion);

  const revert = () => start(() => postRevertToStock());

  return (
    // The dialog is a sibling of the row, not a child of it. A portalled
    // dialog still bubbles its clicks up the React tree, so nesting it inside
    // the row would feed every click back into the row's own open handler.
    <>
      <ButtonBase
        onClick={ () => setOpen(true) }
        sx={ {
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          textAlign: 'left',
          justifyContent: 'flex-start',
          mx: -2.5,
          px: 2.5,
          py: 1.5,
          borderRadius: 1,
        } }
      >
        <WarningAmberIcon sx={ { color: 'text.secondary' } }/>
        <Typography sx={ { fontSize: '1rem' } }>
          Restore upstream free-sleep
        </Typography>
      </ButtonBase>

      <Dialog aria-labelledby={ titleId } open={ open } onClose={ () => { if (phase !== 'updating') { reset(); setOpen(false); } } }>
        <DialogTitle id={ titleId }>
          { phase === 'idle' && 'Restore upstream free-sleep?' }
          { phase === 'updating' && 'Restoring upstream...' }
          { phase === 'failed' && 'Request failed' }
          { phase === 'timed_out' && 'Still not done' }
        </DialogTitle>
        <DialogContent>
          { phase === 'failed' && <Alert severity="error">{ error }</Alert> }
          { phase === 'idle' && (
            <DialogContentText component="div">
              <Typography variant="body2" sx={ { mb: 1.5 } }>
                Download the current throwaway31265/free-sleep main build and replace Nightstand.
                This is an application change, not a factory firmware reset. Nightstand features
                are removed; settings and sleep data remain on the Pod.
              </Typography>
              <Typography variant="body2" sx={ { mb: 1.5 } }>
                The script checks the server and hardware connection and attempts rollback if those
                checks fail. Schedules and alarms pause during restart. Recovery may require SSH.
              </Typography>
              <Typography variant="body2" fontWeight={ 600 }>
                There is no button to come back. Once stock is running, getting back
                requires the migration tool from a computer with SSH access.
              </Typography>
            </DialogContentText>
          ) }
          { phase === 'updating' && (
            <Stack spacing={ 2 } alignItems="center" sx={ { py: 2 } }>
              <CircularProgress/>
              <Typography variant="body2" color="text.secondary">
                Restoring upstream free-sleep. This page reloads by itself when done.
              </Typography>
            </Stack>
          ) }
          { phase === 'timed_out' && (
            <Stack spacing={ 1.5 }>
              <DialogContentText>
                  Restoring upstream free-sleep is not confirmed after 10 minutes.
                  Check the logs and current status before trying again.
              </DialogContentText>
              <Typography variant="body2">
                Last reported running version: { runningVersion ? `v${runningVersion}` : 'unavailable' }.
              </Typography>
              <Stack direction="row" useFlexGap flexWrap="wrap" spacing={ 1 }>
                <Button component={ Link } to="/settings/logs?file=free-sleep-revert.log">Open update logs</Button>
                <Button component={ Link } to="/settings/system">System status</Button>
              </Stack>
            </Stack>
          ) }
        </DialogContent>
        <DialogActions>
          { phase === 'idle' && (
            <>
              <Button onClick={ () => setOpen(false) }>Cancel</Button>
              <Button color="error" variant="contained" onClick={ revert }>Restore upstream</Button>
            </>
          ) }
          { (phase === 'timed_out' || phase === 'failed') && (
            <Button onClick={ () => { reset(); setOpen(false); } }>Close</Button>
          ) }
        </DialogActions>
      </Dialog>
    </>
  );
}
