import { useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Stack, Typography,
} from '@mui/material';
import semver from 'semver';
import MarkdownBody from '@components/MarkdownBody.tsx';
import { postUpdate } from '@api/update.ts';
import { useUpdateProgress } from '@api/useUpdateProgress.ts';
import type { Release } from '@api/releases.ts';
import { palette } from '@design/tokens';

type Props = {
  release: Release;
  runningVersion: string | undefined;
  body: string | undefined;
};

export default function ReleaseRow({ release, runningVersion, body }: Props) {
  const [open, setOpen] = useState(false);
  const { phase, start, reset } = useUpdateProgress(runningVersion);

  const isRunning = release.version === runningVersion;
  const isDowngrade = !!runningVersion && !!semver.valid(runningVersion) && semver.lt(release.version, runningVersion);

  const install = () => start(() => postUpdate({ targetVersion: release.version, allowDowngrade: isDowngrade }));

  return (
    <Box sx={ { py: 1.5, borderBottom: `1px solid ${palette.border.subtle}` } }>
      <Box sx={ { display: 'flex', alignItems: 'center', gap: 1, mb: body ? 1 : 0 } }>
        <Typography sx={ { fontWeight: 600 } }>v{ release.version }</Typography>
        <Typography variant="caption" color="text.secondary">{ release.date }</Typography>
        <Chip label={ release.channel } size="small" variant="outlined"/>
        { isRunning && <Chip label="Running" size="small" color="success"/> }
        <Box sx={ { flex: 1 } }/>
        { !isRunning && (
          <Button size="small" variant="outlined" onClick={ () => setOpen(true) }>
            { isDowngrade ? 'Install (downgrade)' : 'Install' }
          </Button>
        ) }
      </Box>
      { body && <MarkdownBody markdown={ body }/> }

      <Dialog open={ open } onClose={ () => phase !== 'updating' && setOpen(false) }>
        <DialogTitle>
          { phase === 'idle' && `Install v${release.version}?` }
          { phase === 'updating' && 'Installing...' }
          { phase === 'timed_out' && 'Still not done' }
        </DialogTitle>
        <DialogContent>
          { phase === 'idle' && (
            <DialogContentText>
              { isDowngrade
                ? `This downgrades from v${runningVersion} to v${release.version}. Your data is kept ` +
                  '(databases aren\'t rewritten). Installing any version replaces the instant-rollback slot, ' +
                  'so you won\'t be able to instantly roll back to what\'s running now afterward.'
                : `The pod will download v${release.version}, back itself up, install, and verify its own ` +
                  'health. It rolls back automatically if the new build fails health checks.' }
              { ' ' }Temperature control keeps running throughout; the app will be unreachable for a few
              seconds during the switch.
            </DialogContentText>
          ) }
          { phase === 'updating' && (
            <Stack spacing={ 2 } alignItems="center" sx={ { py: 2 } }>
              <CircularProgress/>
              <Typography variant="body2" color="text.secondary">
                Installing v{ release.version }. This page reloads by itself when the pod comes back.
              </Typography>
            </Stack>
          ) }
          { phase === 'timed_out' && (
            <DialogContentText>
              The pod hasn't reported the new version after 10 minutes. It may have rolled back
              (the previous version keeps running) or the download may be slow. Check the log on
              the pod: <code>/persistent/free-sleep-data/logs/free-sleep-update.log</code>
            </DialogContentText>
          ) }
        </DialogContent>
        <DialogActions>
          { phase === 'idle' && (
            <>
              <Button onClick={ () => setOpen(false) }>Cancel</Button>
              <Button variant="contained" onClick={ install }>Install now</Button>
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
