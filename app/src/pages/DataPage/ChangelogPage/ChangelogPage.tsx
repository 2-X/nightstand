import semver from 'semver';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Alert, Button, Accordion, AccordionDetails, AccordionSummary, Box, Chip, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { SubpageShell } from '../Header.tsx';
import MarkdownBody from '@components/MarkdownBody.tsx';
import { useChangelog, useRemoteChangelog, entriesNewerThan } from '@api/changelog.ts';
import type { ChangelogEntry } from '@api/changelogSchema';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { useSettings } from '@api/settings';
import { useLatestVersion } from '@api/useLatestVersion.ts';
import { palette } from '@design/tokens';

function summary(body: string) {
  const first = body.split('\n').find(line => line.trim() && !line.startsWith('#')) ?? 'Release notes';
  return first.replace(/^\s*[-*]\s+/, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, '').slice(0, 180);
}

export default function ChangelogPage() {
  const { data: localEntries, isError, isPending, refetch } = useChangelog();
  const { data: remoteEntries } = useRemoteChangelog();
  const { data: deviceStatus } = useDeviceStatus();
  const latest = useLatestVersion();
  const { data: settings } = useSettings();
  const running = deviceStatus?.freeSleep?.version;
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash, localEntries, remoteEntries]);
  const byVersion = new Map<string, ChangelogEntry>();
  for (const entry of [...(localEntries ?? []), ...entriesNewerThan(remoteEntries, running)]) {
    if (!byVersion.has(entry.version)) byVersion.set(entry.version, entry);
  }
  const entries = [...byVersion.values()]
    .sort((left, right) => semver.valid(left.version) && semver.valid(right.version)
      ? semver.rcompare(left.version, right.version)
      : semver.valid(left.version) ? 1 : semver.valid(right.version) ? -1 : left.version.localeCompare(right.version));

  return (
    <SubpageShell title="Release notes" backTo="/settings/versions" backLabel="Back to Software">
      <Stack spacing={ 2 } useFlexGap sx={ { width: '100%' } }>
        { isError && <Alert severity="error" action={ <Button onClick={ () => void refetch() }>Retry</Button> }>
          Release notes could not be loaded.
        </Alert> }
        { isPending && <Typography role="status">Loading release notes...</Typography> }
        { !isError && !isPending && entries.length === 0 &&
          <Typography variant="body2" color="text.secondary">No changelog entries available.</Typography> }
        { entries.map(entry => (
          <Accordion
            key={ entry.version }
            id={ `release-v${entry.version}` }
            defaultExpanded={ hash === `#release-v${entry.version}` }
            disableGutters
            slotProps={ { transition: { unmountOnExit: true } } }
            sx={ { backgroundColor: palette.bg.elevated, scrollMarginTop: 24 } }
          >
            <AccordionSummary expandIcon={ <ExpandMoreIcon/> }>
              <Box sx={ { minWidth: 0 } }>
                <Box sx={ { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 } }>
                  <Typography variant="subtitle1" sx={ { fontWeight: 600 } }>v{ entry.version }</Typography>
                  <Typography variant="caption" color="text.secondary">{ entry.date }</Typography>
                  { entry.version === running && <Chip label="Running" size="small" variant="outlined"/> }
                  { entry.version === latest && <Chip
                    label={ settings?.updateChannel === 'beta' ? 'Latest beta' : 'Latest stable' }
                    size="small"
                    variant="outlined"/> }
                </Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={ { mt: 0.5, overflowWrap: 'anywhere', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }>
                  { summary(entry.body) }
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails><MarkdownBody markdown={ entry.body }/></AccordionDetails>
          </Accordion>
        )) }
      </Stack>
    </SubpageShell>
  );
}
