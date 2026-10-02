import { useRef, useState } from 'react';
import { Alert, Button, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import type { Release } from '@api/releases.ts';
import { postSettings } from '@api/settings.ts';

export function runningBetaOnStable(
  running: string | undefined,
  releases: Release[] | undefined,
  saved: 'stable' | 'beta' | undefined,
): boolean {
  const entry = releases?.find(release => release.version === running);
  return entry?.channel === 'beta' && (saved ?? 'stable') === 'stable';
}

export default function BetaOnStableNotice({ running, releases, saved, onSwitched }: {
  running: string | undefined; releases: Release[] | undefined; saved: 'stable' | 'beta' | undefined;
  onSwitched?: () => void;
}) {
  const client = useQueryClient();
  const [error, setError] = useState(false);
  const switching = useRef(false);
  if (!runningBetaOnStable(running, releases, saved)) return null;
  const switchToBeta = () => {
    if (switching.current) return;
    switching.current = true;
    setError(false);
    postSettings({ updateChannel: 'beta' })
      .then(() => client.invalidateQueries({ queryKey: ['useSettings'] }))
      .then(() => onSwitched?.())
      .catch(() => setError(true))
      .finally(() => { switching.current = false; });
  };
  return (
    <Alert
      severity="info"
      role="status"
      sx={ { flexWrap: 'wrap', '& .MuiAlert-message': { flex: '1 1 0', minWidth: 0 },
        '& .MuiAlert-action': { flex: { xs: '1 0 100%', sm: '0 0 auto' }, ml: { xs: 0, sm: 'auto' }, pt: { xs: 0, sm: 'inherit' } } } }
      action={ <Button color="inherit" sx={ { minHeight: 44 } } onClick={ switchToBeta }>Switch to Beta</Button> }>
      { `You are running v${running}, a beta release. Your update channel is Stable, ` +
        'so updates appear once a stable release is newer than this one.' }
      { error && (
        <Typography role="alert" variant="body2" color="error" sx={ { mt: 1 } }>
          Could not save the update channel. Try again.
        </Typography>
      ) }
    </Alert>
  );
}
