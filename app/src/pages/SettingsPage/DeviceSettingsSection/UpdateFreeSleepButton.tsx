import { Link } from 'react-router-dom';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Slide from '@mui/material/Slide';
import { TransitionProps } from '@mui/material/transitions';
import { useEffect, useState, useId, useRef, forwardRef, type ReactElement, type Ref } from 'react';
import { postUpdate } from '@api/update.ts';
import { useLatestVersion } from '@api/useLatestVersion.ts';
import { useUpdateProgress } from '@api/useUpdateProgress.ts';
import { UpdateOutcome } from '@state/updateAttentionStore';
import semver from 'semver';

const Transition = forwardRef(function Transition(
  props: TransitionProps & {
    children: ReactElement<any, any>;
  },
  ref: Ref<unknown>,
) {
  return <Slide direction="up" ref={ ref } { ...props } />;
});

// Triggers the Pod's self-updater (scripts/update.sh via
// free-sleep-update.service) to install the latest published build. The pod
// downloads it, backs itself up, swaps, health-checks, and rolls back on its
// own if the new build fails.
// eslint-disable-next-line react/no-multi-comp
export default function UpdateFreeSleepButton({ runningVersion, onProblem, onStart, retry = false }: {
  runningVersion: string; onProblem?: (outcome: UpdateOutcome, startVersion: string) => void; onStart?: () => void; retry?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const startVersion = useRef(runningVersion);
  const latestVersion = useLatestVersion();
  const [targetVersion, setTargetVersion] = useState<string>();
  const { phase, error, start, reset } = useUpdateProgress(runningVersion);

  useEffect(() => { if (phase === 'failed' || phase === 'timed_out') onProblem?.(phase, startVersion.current); }, [phase, onProblem]);

  const isNewer = (target?: string) => !!target && !!semver.valid(target) && !!semver.valid(runningVersion)
    && semver.gt(target, runningVersion);
  const startUpdate = () => {
    if (targetVersion && isNewer(targetVersion)) {
      startVersion.current = runningVersion;
      onStart?.();
      void start(() => postUpdate({ targetVersion }));
    }
  };

  return (
    <>
      <Button
        variant="contained"
        disabled={ !isNewer(latestVersion) }
        onClick={ () => { reset(); setTargetVersion(latestVersion); setOpen(true); } }
        size="small"
        sx={ { width: '100%', minHeight: 48, fontSize: 15 } }
      >
        { retry ? 'Try again' : `Update${latestVersion ? ` to ${latestVersion}` : ''}` }
      </Button>
      <Dialog
        open={ open }
        aria-labelledby={ titleId }
        slots={ {
          transition: Transition,
        } }
        keepMounted
        onClose={ () => { if (phase !== 'updating') { reset(); setOpen(false); } } }
      >
        <DialogTitle id={ titleId }>
          { phase === 'idle' && `Update to v${targetVersion}?` }
          { phase === 'updating' && 'Updating...' }
          { phase === 'failed' && 'Request failed' }
          { phase === 'timed_out' && 'Still not done' }
        </DialogTitle>
        <DialogContent>
          { phase === 'failed' && <Alert severity="error">
            The Pod did not accept the update request. Nothing was installed.
            { error && <Typography variant="body2">{ error }</Typography> }
          </Alert> }
          { phase === 'idle' && (
            <>
              <DialogContentText>
                The Pod restarts to finish, and schedules and alarms pause for 2 to 5 minutes.
                If the checks fail, it attempts to go back to v{ runningVersion } on its own.
              </DialogContentText>
              <details><summary>If it doesn't come back</summary>
                <Typography variant="body2">Recovery may require SSH. Check the update logs and system status before trying again.</Typography>
              </details>
            </>
          ) }
          { phase === 'updating' && (
            <Stack spacing={ 2 } alignItems="center" sx={ { py: 2 } }>
              <CircularProgress/>
              <Typography variant="body2" color="text.secondary">
                Installing { targetVersion }. This page reloads by itself
                when the Pod comes back on the new version.
              </Typography>
            </Stack>
          ) }
          { phase === 'timed_out' && (
            <Stack spacing={ 1.5 }>
              <DialogContentText>
                  Installation of v{ targetVersion } is not confirmed after 10 minutes. The Pod may
                  still be updating or may have rolled back. Check its logs and current status.
              </DialogContentText>
              <Typography variant="body2">
                Last reported running version: { runningVersion ? `v${runningVersion}` : 'unavailable' }.
              </Typography>
              <Stack direction="row" useFlexGap flexWrap="wrap" spacing={ 1 }>
                <Button component={ Link } to="/settings/logs?file=free-sleep-update.log">Open update logs</Button>
                <Button component={ Link } to="/settings/system">System status</Button>
              </Stack>
            </Stack>
          ) }
        </DialogContent>
        <DialogActions>
          { phase === 'idle' && (
            <>
              <Button onClick={ () => setOpen(false) }>Cancel</Button>
              <Button variant="contained" disabled={ !isNewer(targetVersion) } onClick={ startUpdate }>Update now</Button>
            </>
          ) }
          { phase === 'failed' && <Button onClick={ startUpdate }>Try again</Button> }
          { (phase === 'timed_out' || phase === 'failed') && (
            <Button onClick={ () => { reset(); setOpen(false); } }>Close</Button>
          ) }
        </DialogActions>
      </Dialog>
    </>
  );
}
