import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { SubpageShell } from '../Header.tsx';
import MarkdownBody from '@components/MarkdownBody.tsx';
import { useChangelog, useRemoteChangelog, entriesNewerThan } from '@api/changelog.ts';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { useLatestVersion } from '@api/useLatestVersion.ts';
import { palette } from '@design/tokens';

function summary(body: string) {
  const first = body.split('\n').find(line => line.trim() && !line.startsWith('#')) ?? 'Release notes';
  return first.replace(/^\s*[-*]\s+/, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, '').slice(0, 180);
}

export default function ChangelogPage() {
  const { data: localEntries } = useChangelog();
  const { data: remoteEntries } = useRemoteChangelog();
  const { data: deviceStatus } = useDeviceStatus();
  const latest = useLatestVersion();
  const running = deviceStatus?.freeSleep?.version;
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash, localEntries, remoteEntries]);
  const localVersions = new Set((localEntries ?? []).map(entry => entry.version));
  // Preserve local changelog ordering and prepend newer remote releases.
  const entries = [
    ...entriesNewerThan(remoteEntries, running).filter(entry => !localVersions.has(entry.version)),
    ...(localEntries ?? []),
  ];

  return (
    <SubpageShell title="Changelog">
      <Stack spacing={ 1 } sx={ { width: '100%' } }>
        { entries.length === 0 && <Typography variant="body2" color="text.secondary">No changelog entries available.</Typography> }
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
                  { entry.version === latest && <Chip label="Latest on your channel" size="small" variant="outlined"/> }
                </Box>
                <Typography variant="body2" color="text.secondary" sx={ { mt: 0.5, overflowWrap: 'anywhere' } }>
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
