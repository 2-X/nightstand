import { useState, useId } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Stack, Typography,
} from '@mui/material';
import semver from 'semver';
import MarkdownBody from '@components/MarkdownBody.tsx';
import { postUpdate } from '@api/update.ts';
import { migrationsApplied, useUpdateProgress } from '@api/useUpdateProgress.ts';
import type { Release } from '@api/releases.ts';
import { palette } from '@design/tokens';

type Props = {
  release: Release;
  runningVersion: string | undefined;
  body: string | undefined;
  // The database has migrations this version ships but never applied. A
  // reinstall of the running version is the one thing that finishes them.
  offerReinstall?: boolean;
};

export default function ReleaseRow({ release, runningVersion, body, offerReinstall = false }: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const isRunning = release.version === runningVersion;
  const isReinstall = isRunning && offerReinstall;
  // A reinstall never changes the running version, so it is done when the
  // database is, not when the version moves.
  const { phase, error, start, reset } = useUpdateProgress(runningVersion, isReinstall ? migrationsApplied : undefined);

  const isDowngrade = !!runningVersion && !!semver.valid(runningVersion) && semver.lt(release.version, runningVersion);

  const install = () => start(() => postUpdate({ targetVersion: release.version, allowDowngrade: isDowngrade }));

  return (
    <Box sx={ { py: 1.5, borderBottom: `1px solid ${palette.border.subtle}` } }>
      <Box sx={ { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: body ? 1 : 0 } }>
        <Typography sx={ { fontWeight: 600 } }>v{ release.version }</Typography>
        <Typography variant="caption" color="text.secondary">{ release.date }</Typography>
        <Chip label={ release.channel } size="small" variant="outlined"/>
        { isRunning && <Chip label="Running" size="small" color="success"/> }
        <Box sx={ { flex: 1 } }/>
        { (!isRunning || isReinstall) && (
          <Button size="small" variant="outlined" onClick={ () => setOpen(true) }>
            { isReinstall ? 'Reinstall' : isDowngrade ? 'Install (downgrade)' : 'Install' }
          </Button>
        ) }
      </Box>
      { body && (
        <details>
          <summary>Release notes</summary>
          <MarkdownBody markdown={ body }/>
          <Button component={ Link } to={ `/changelog#release-v${release.version}` } size="small">View in changelog</Button>
        </details>
      ) }

      <Dialog aria-labelledby={ titleId } open={ open } onClose={ () => { if (phase !== 'updating') { reset(); setOpen(false); } } }>
        <DialogTitle id={ titleId }>
          { phase === 'idle' && `${isReinstall ? 'Reinstall' : 'Install'} v${release.version}?` }
          { phase === 'updating' && 'Installing...' }
          { phase === 'failed' && 'Request failed' }
          { phase === 'timed_out' && 'Still not done' }
        </DialogTitle>
        <DialogContent>
          { phase === 'failed' && <Alert severity="error">{ error }</Alert> }
          { phase === 'idle' && (
            <DialogContentText>
              { isReinstall
                ? `This reinstalls v${release.version} to finish database changes an earlier update left ` +
                  'undone. Your data is kept, and the new updater applies what is missing.'
                : isDowngrade
                  ? `This downgrades from v${runningVersion} to v${release.version}. Your data is kept ` +
                  'Database migrations are not reversed. The running installation becomes the rollback slot.'
                  : `The pod will download v${release.version}, back itself up, install, and verify its own ` +
                  'health. It attempts rollback if the new build fails health checks.' }
              { ' ' }The app, schedules, and alarms pause during restart. Recovery may require SSH.
            </DialogContentText>
          ) }
          { phase === 'updating' && (
            <Stack spacing={ 2 } alignItems="center" sx={ { py: 2 } }>
              <CircularProgress/>
              <Typography variant="body2" color="text.secondary">
                Installing v{ release.version }. This page reloads by itself when the Pod comes back.
              </Typography>
            </Stack>
          ) }
          { phase === 'timed_out' && (
            <Stack spacing={ 1.5 }>
              <DialogContentText>
                { isReinstall ? `Reinstallation and database changes for v${release.version} are not confirmed`
                  : `Installation of v${release.version} is not confirmed` }
                { ' ' }after 10 minutes. The Pod may still be working or may have rolled back.
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
              <Button variant="contained" onClick={ install }>{ isReinstall ? 'Reinstall now' : 'Install now' }</Button>
            </>
          ) }
          { (phase === 'timed_out' || phase === 'failed') && (
            <Button onClick={ () => { reset(); setOpen(false); } }>Close</Button>
          ) }
        </DialogActions>
      </Dialog>
    </Box>
  );
}
