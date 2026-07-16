import { useState } from 'react';
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
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
  const { phase, start, reset } = useUpdateProgress(runningVersion);

  const revert = () => start(() => postRevertToStock());

  return (
    <Box
      onClick={ () => setOpen(true) }
      sx={ {
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        cursor: 'pointer',
        mx: -2.5,
        px: 2.5,
        py: 1.5,
        borderRadius: 1,
      } }
    >
      <WarningAmberIcon sx={ { color: 'text.secondary' } }/>
      <Typography sx={ { fontSize: '1rem' } }>
        Revert to stock upstream free-sleep
      </Typography>

      <Dialog open={ open } onClose={ () => phase !== 'updating' && setOpen(false) }>
        <DialogTitle>
          { phase === 'idle' && 'Revert to stock upstream?' }
          { phase === 'updating' && 'Reverting to stock...' }
          { phase === 'timed_out' && 'Still not done' }
        </DialogTitle>
        <DialogContent>
          { phase === 'idle' && (
            <DialogContentText component="div">
              <Typography variant="body2" sx={ { mb: 1.5 } }>
                This backs up the current install and replaces it with plain
                throwaway31265/free-sleep, the project Nightstand is built on. Every
                Nightstand feature goes away: the update system, presence-detection
                fixes, the design, all of it. Your settings, schedules, and data are
                preserved and not rewritten.
              </Typography>
              <Typography variant="body2" sx={ { mb: 1.5 } }>
                The pod verifies stock is healthy afterward; if that check fails, it swaps
                back and Nightstand keeps running.
              </Typography>
              <Typography variant="body2" fontWeight={ 600 }>
                There is no button to come back. Once stock is running, getting back
                requires re-running the adoption tool from a computer.
              </Typography>
            </DialogContentText>
          ) }
          { phase === 'updating' && (
            <Stack spacing={ 2 } alignItems="center" sx={ { py: 2 } }>
              <CircularProgress/>
              <Typography variant="body2" color="text.secondary">
                Reverting to stock upstream. This page reloads by itself when done.
              </Typography>
            </Stack>
          ) }
          { phase === 'timed_out' && (
            <DialogContentText>
              The pod hasn't reported a version change after 10 minutes. Check the log on the pod:
              <code> /persistent/free-sleep-data/logs/free-sleep-revert.log</code>
            </DialogContentText>
          ) }
        </DialogContent>
        <DialogActions>
          { phase === 'idle' && (
            <>
              <Button onClick={ () => setOpen(false) }>Cancel</Button>
              <Button color="error" variant="contained" onClick={ revert }>Revert to stock</Button>
            </>
          ) }
          { phase === 'timed_out' && (
            <Button onClick={ () => { reset(); setOpen(false); } }>Close</Button>
          ) }
        </DialogActions>
      </Dialog>
    </Box>
  );
}
