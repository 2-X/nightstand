import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import PageContainer from '../../PageContainer.tsx';
import Header from '../Header.tsx';
import MarkdownBody from '@components/MarkdownBody.tsx';
import { useChangelog, useRemoteChangelog, entriesNewerThan } from '@api/changelog.ts';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { palette } from '@design/tokens';

export default function ChangelogPage() {
  const { data: localEntries } = useChangelog();
  const { data: remoteEntries } = useRemoteChangelog();
  const { data: deviceStatus } = useDeviceStatus();
  const running = deviceStatus?.freeSleep?.version;

  const installedVersions = new Set((localEntries ?? []).map(entry => entry.version));
  // Normally disjoint from localEntries (the running version is always the
  // newest local entry), but guard against version keys colliding: a stale
  // or hand-edited CHANGELOG.md shouldn't be able to produce a duplicate
  // React key or list a version as both installed and not.
  const notInstalledYet = entriesNewerThan(remoteEntries, running)
    .filter(entry => !installedVersions.has(entry.version));
  const entries = [
    ...notInstalledYet.map(entry => ({ ...entry, installed: false })),
    ...(localEntries ?? []).map(entry => ({ ...entry, installed: true })),
  ];

  return (
    <PageContainer>
      <Header title="Changelog" icon={ <HistoryIcon/> }/>
      <Stack spacing={ 2 } sx={ { width: '100%' } }>
        { entries.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No changelog entries available.
          </Typography>
        ) }
        { entries.map(entry => (
          <Paper key={ entry.version } sx={ { p: 2, backgroundColor: palette.bg.elevated } }>
            <Box sx={ { display: 'flex', alignItems: 'center', gap: 1, mb: 1 } }>
              <Typography variant="subtitle1" sx={ { fontWeight: 600 } }>
                v{ entry.version }
              </Typography>
              <Typography variant="caption" color="text.secondary">
                { entry.date }
              </Typography>
              { !entry.installed && (
                <Chip label="Not installed yet" size="small" color="info" variant="outlined"/>
              ) }
            </Box>
            <MarkdownBody markdown={ entry.body }/>
          </Paper>
        )) }
      </Stack>
    </PageContainer>
  );
}
