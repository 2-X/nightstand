import { useState } from 'react';
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Stack, Typography,
} from '@mui/material';
import RestorePageIcon from '@mui/icons-material/RestorePage';
import { postRollback } from '@api/update.ts';
import { useUpdateProgress } from '@api/useUpdateProgress.ts';

type Props = {
  runningVersion: string | undefined;
  rollbackVersion: string;
};

export default function RollbackRow({ runningVersion, rollbackVersion }: Props) {
  const [open, setOpen] = useState(false);
  const { phase, start, reset } = useUpdateProgress(runningVersion);

  const rollback = () => start(() => postRollback());

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
      <RestorePageIcon sx={ { color: 'text.secondary' } }/>
      <Typography sx={ { fontSize: '1rem' } }>
        Roll back to v{ rollbackVersion } (instant, no download)
      </Typography>

      <Dialog open={ open } onClose={ () => phase !== 'updating' && setOpen(false) }>
        <DialogTitle>
          { phase === 'idle' && `Roll back to v${rollbackVersion}?` }
          { phase === 'updating' && 'Rolling back...' }
          { phase === 'timed_out' && 'Still not done' }
        </DialogTitle>
        <DialogContent>
          { phase === 'idle' && (
            <DialogContentText>
              This swaps to the exact tree that was running before the current install — seconds,
              fully offline, no download. The pod verifies it's healthy afterward; if that check
              fails, it swaps back and v{ runningVersion } keeps running. This uses up the
              instant-rollback slot, so a second rollback isn't available until you install
              something new.
            </DialogContentText>
          ) }
          { phase === 'updating' && (
            <Stack spacing={ 2 } alignItems="center" sx={ { py: 2 } }>
              <CircularProgress/>
              <Typography variant="body2" color="text.secondary">
                Rolling back to v{ rollbackVersion }. This page reloads by itself when done.
              </Typography>
            </Stack>
          ) }
          { phase === 'timed_out' && (
            <DialogContentText>
              The pod hasn't reported a version change after 10 minutes. Check the log on the pod:
              <code> /persistent/free-sleep-data/logs/free-sleep-rollback.log</code>
            </DialogContentText>
          ) }
        </DialogContent>
        <DialogActions>
          { phase === 'idle' && (
            <>
              <Button onClick={ () => setOpen(false) }>Cancel</Button>
              <Button variant="contained" onClick={ rollback }>Roll back now</Button>
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
