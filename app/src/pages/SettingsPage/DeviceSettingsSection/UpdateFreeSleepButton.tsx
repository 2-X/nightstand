import { Button, CircularProgress, Stack, Typography } from '@mui/material';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Slide from '@mui/material/Slide';
import { TransitionProps } from '@mui/material/transitions';
import { useState, forwardRef, type ReactElement, type Ref } from 'react';
import { postJobs } from '@api/jobs.ts';
import { useServerInfo } from '@api/serverInfo.ts';
import { useUpdateProgress } from '@api/useUpdateProgress.ts';

const Transition = forwardRef(function Transition(
  props: TransitionProps & {
    children: ReactElement<any, any>;
  },
  ref: Ref<unknown>,
) {
  return <Slide direction="up" ref={ ref } { ...props } />;
});

// Triggers the pod's self-updater (scripts/update.sh via
// free-sleep-update.service) to install the latest published build. The pod
// downloads it, backs itself up, swaps, health-checks, and rolls back on its
// own if the new build fails.
// eslint-disable-next-line react/no-multi-comp
export default function UpdateFreeSleepButton({ runningVersion }: { runningVersion: string }) {
  const [open, setOpen] = useState(false);
  const { data: serverInfo } = useServerInfo();
  const { phase, start, reset } = useUpdateProgress(runningVersion);

  const startUpdate = () => start(() => postJobs(['update']));

  return (
    <>
      <Button variant="contained" onClick={ () => setOpen(true) } size="small" sx={ { width: '150px' } }>
        Update
      </Button>
      <Dialog
        open={ open }
        slots={ {
          transition: Transition,
        } }
        keepMounted
        onClose={ () => phase !== 'updating' && setOpen(false) }
      >
        <DialogTitle>
          { phase === 'idle' && `Update to ${serverInfo?.version}?` }
          { phase === 'updating' && 'Updating...' }
          { phase === 'timed_out' && 'Still not done' }
        </DialogTitle>
        <DialogContent>
          { phase === 'idle' && (
            <DialogContentText>
              The pod will download the latest build of this fork from GitHub,
              back itself up, install, and verify its own health. If the new
              build fails, it rolls back to v{ runningVersion } automatically.
              Temperature control keeps running; the app will be unreachable
              for a few seconds during the switch. Usually takes 2 to 5 minutes.
            </DialogContentText>
          ) }
          { phase === 'updating' && (
            <Stack spacing={ 2 } alignItems="center" sx={ { py: 2 } }>
              <CircularProgress/>
              <Typography variant="body2" color="text.secondary">
                Installing { serverInfo?.version }. This page reloads by itself
                when the pod comes back on the new version.
              </Typography>
            </Stack>
          ) }
          { phase === 'timed_out' && (
            <DialogContentText>
              The pod hasn't reported the new version after 10 minutes. It may
              have rolled back (which means the old version keeps running) or
              the download may be slow. Check the log on the pod:
              <code> /persistent/free-sleep-data/logs/free-sleep-update.log</code>
            </DialogContentText>
          ) }
        </DialogContent>
        <DialogActions>
          { phase === 'idle' && (
            <>
              <Button onClick={ () => setOpen(false) }>Cancel</Button>
              <Button variant="contained" onClick={ startUpdate }>Update now</Button>
            </>
          ) }
          { phase === 'timed_out' && (
            <Button onClick={ () => { reset(); setOpen(false); } }>Close</Button>
          ) }
        </DialogActions>
      </Dialog>
    </>
  );
}
