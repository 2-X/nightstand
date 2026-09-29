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
          width: '100%',
          minHeight: 44,
          px: 0,
          py: 1.5,
          borderRadius: 1,
        } }
      >
        <WarningAmberIcon sx={ { color: 'text.secondary' } }/>
        <Typography sx={ { fontSize: '1rem' } }>
          Switch to upstream free-sleep
        </Typography>
      </ButtonBase>

      <Dialog aria-labelledby={ titleId } open={ open } onClose={ () => { if (phase !== 'updating') { reset(); setOpen(false); } } }>
        <DialogTitle id={ titleId }>
          { phase === 'idle' && 'Switch to upstream free-sleep?' }
          { phase === 'updating' && 'Switching to upstream...' }
          { phase === 'failed' && 'Request failed' }
          { phase === 'timed_out' && 'Still not done' }
        </DialogTitle>
        <DialogContent>
          { phase === 'failed' && <Alert severity="error">{ error }</Alert> }
          { phase === 'idle' && (
            <DialogContentText component="div">
              <Typography variant="body2" sx={ { mb: 2 } }>
                Replace Nightstand with the current upstream free-sleep build. Nightstand features are removed,
                but settings and sleep data remain on the Pod. Schedules and alarms pause during restart.
              </Typography>
              <Typography variant="body2">
                Returning to Nightstand requires the migration tool from a computer with SSH access.
                If installation checks fail, the Pod attempts rollback. Recovery may require SSH.
              </Typography>
            </DialogContentText>
          ) }
          { phase === 'updating' && (
            <Stack spacing={ 2 } alignItems="center" sx={ { py: 2 } }>
              <CircularProgress/>
              <Typography variant="body2" color="text.secondary">
                Switching to upstream free-sleep. This page reloads by itself when done.
              </Typography>
            </Stack>
          ) }
          { phase === 'timed_out' && (
            <Stack spacing={ 1.5 }>
              <DialogContentText>
                  Switching to upstream free-sleep is not confirmed after 10 minutes.
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
        <DialogActions
          sx={ { flexDirection: { xs: 'column', sm: 'row' }, gap: 1, px: 3, pb: 3,
            '& > :not(style) ~ :not(style)': { ml: 0 }, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' } } } }>
          { phase === 'idle' && (
            <>
              <Button onClick={ () => setOpen(false) }>Cancel</Button>
              <Button color="error" variant="contained" onClick={ revert }>Switch to upstream free-sleep</Button>
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
