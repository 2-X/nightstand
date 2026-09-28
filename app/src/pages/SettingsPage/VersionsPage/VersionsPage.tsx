import { useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary,
  Alert, AlertTitle, Box, Chip, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import semver from 'semver';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PageContainer from '../../PageContainer.tsx';
import Header from '../../DataPage/Header.tsx';
import Section from '../Section.tsx';
import MarkdownBody from '@components/MarkdownBody.tsx';
import UpdateFreeSleepButton from '../DeviceSettingsSection/UpdateFreeSleepButton.tsx';
import ReleaseRow from './ReleaseRow.tsx';
import RollbackRow from './RollbackRow.tsx';
import RevertToStockRow from './RevertToStockRow.tsx';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { useSettings, postSettings } from '@api/settings.ts';
import { useLatestVersion } from '@api/useLatestVersion.ts';
import { useReleases } from '@api/releases.ts';
import { useChangelog, useRemoteChangelog, entriesNewerThan } from '@api/changelog.ts';
import { useRollbackInfo } from '@api/update.ts';
import { useServerStatus } from '@api/serverStatus.ts';
import { UPDATE_CHANNELS, UpdateChannelType } from '@api/settingsSchema.ts';
import currentServerInfo from '../../../../../server/src/serverInfo.json';

// First release that understands update-target.json. Older update.sh
// ignores the file and always installs the branch tip instead, which is
// harmless but means the picker and rollback wouldn't do what they say.
// Reads deviceStatus (the live running version), not the served bundle, so
// a stale cached page can't show a picker that won't work. 3.0.0 is this
// stream's first release and ships both the target protocol and the rollback
// service, so it is the floor. Keep it in step with FLOOR_VERSION in
// scripts/update.sh, which gates the same picker from the pod side.
const CAPABLE_FLOOR = '3.0.0';

export default function VersionsPage() {
  const { data: deviceStatus } = useDeviceStatus();
  const { data: settings, refetch: refetchSettings } = useSettings();
  const { data: releases, isError: releasesFailed } = useReleases();
  const [channelError, setChannelError] = useState<string>();
  const [savingChannel, setSavingChannel] = useState(false);
  const { data: localChangelog } = useChangelog();
  const { data: remoteChangelog } = useRemoteChangelog();
  const { data: rollbackInfo } = useRollbackInfo();
  // Only the running row acts on this: it offers a reinstall to finish
  // migrations an earlier update could not apply.
  const { data: serverStatus } = useServerStatus();
  const offerReinstall = !!serverStatus?.database?.unappliedMigrations?.length;
  const latestVersion = useLatestVersion();

  const running = deviceStatus?.freeSleep?.version;
  const branch = deviceStatus?.freeSleep?.branch;
  const channel: UpdateChannelType = settings?.updateChannel ?? 'stable';
  const capable = !!running && semver.valid(running) && semver.gte(running, CAPABLE_FLOOR);

  const eligibleVersions = new Set(releases?.releases
    .filter(release => channel === 'beta' || release.channel === 'stable')
    .map(release => release.version));
  const whatsNew = entriesNewerThan(remoteChangelog, running)
    .filter(entry => eligibleVersions.has(entry.version));

  const updateAvailable =
    !!latestVersion && !!running && !!semver.valid(running) && !!semver.valid(latestVersion) &&
    semver.gt(latestVersion, running);
  const bodyByVersion = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of remoteChangelog ?? []) map.set(entry.version, entry.body);
    for (const entry of localChangelog ?? []) map.set(entry.version, entry.body);
    return map;
  }, [remoteChangelog, localChangelog]);

  return (
    <PageContainer sx={ { mb: 15, pt: 3, gap: 2, alignItems: 'stretch' } }>
      <Header title="Software & updates" icon={ <SystemUpdateAltIcon/> }/>

      <Box sx={ { display: 'flex', gap: 1, alignItems: 'center' } }>
        <Typography variant="body2">Nightstand</Typography>
        { running && <Chip label={ `v${running}` } size="small"/> }
        { branch && <Chip label={ branch } size="small"/> }
        {
          latestVersion && !updateAvailable && (
            <Chip icon={ <CheckCircleIcon/> } label="Up to date" color="success" variant="filled" size="small"/>
          )
        }
      </Box>

      { releasesFailed && <Alert severity="warning">Release information is unavailable. Try again when your browser can reach GitHub.</Alert> }
      { updateAvailable && (
        <Alert severity="info">
          <AlertTitle>Update available</AlertTitle>
          <Typography variant="body2" sx={ { mb: 1 } }>
            This pod is running v{ running }. The latest build on your channel is v{ latestVersion }.
          </Typography>
          { whatsNew.length > 0 && (
            <Accordion
              disableGutters
              square
              sx={ { background: 'transparent', boxShadow: 'none', mb: 1, '&:before': { display: 'none' } } }
            >
              <AccordionSummary expandIcon={ <ExpandMoreIcon/> } sx={ { px: 0, minHeight: 0 } }>
                <Typography variant="body2">What's new</Typography>
              </AccordionSummary>
              <AccordionDetails
                sx={ { px: 0, maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5 } }
              >
                { whatsNew.map(entry => (
                  <Box key={ entry.version }>
                    <Typography variant="caption" sx={ { fontWeight: 600 } }>
                      v{ entry.version }, { entry.date }
                    </Typography>
                    <MarkdownBody markdown={ entry.body }/>
                  </Box>
                )) }
              </AccordionDetails>
            </Accordion>
          ) }
          <UpdateFreeSleepButton runningVersion={ running ?? currentServerInfo.version }/>
        </Alert>
      ) }

      <Section title="Update channel">
        <ToggleButtonGroup
          value={ channel }
          exclusive
          disabled={ savingChannel }
          size="small"
          onChange={ (_e, value: UpdateChannelType | null) => {
            if (!value) return;
            setChannelError(undefined);
            setSavingChannel(true);
            postSettings({ updateChannel: value })
              .then(() => refetchSettings())
              .catch(() => setChannelError('Could not save the update channel. Try selecting it again.'))
              .finally(() => setSavingChannel(false));
          } }
        >
          { UPDATE_CHANNELS.map(c => (
            <ToggleButton key={ c } value={ c }>{ c }</ToggleButton>
          )) }
        </ToggleButtonGroup>
        { channelError && <Alert severity="error" sx={ { mt: 1 } }>{ channelError }</Alert> }
        <Typography variant="caption" color="text.secondary" sx={ { display: 'block', mt: 1 } }>
          Beta sees every release as soon as it ships. Stable only sees releases that have been
          promoted after at least seven nights of use.
        </Typography>
      </Section>

      { !capable && (
        <Alert severity="warning">
          Update to v{ CAPABLE_FLOOR } or later to unlock picking a specific version and instant
          rollback.
        </Alert>
      ) }

      { capable && rollbackInfo?.available && rollbackInfo.version && (
        <Section title="Previous installation">
          <RollbackRow runningVersion={ running } rollbackVersion={ rollbackInfo.version }/>
        </Section>
      ) }

      { capable && releases && (
        <Section title="All releases">
          <Typography variant="caption" color="text.secondary" sx={ { display: 'block', mb: 1 } }>
            Downgrading keeps your data (databases aren't rewritten). Installing any version
            replaces the instant-rollback slot above. Versions below v{ CAPABLE_FLOOR } can't be
            installed from here.
          </Typography>
          { releases.releases.map(release => (
            <ReleaseRow
              key={ release.version }
              release={ release }
              runningVersion={ running }
              body={ bodyByVersion.get(release.version) }
              offerReinstall={ offerReinstall }
            />
          )) }
        </Section>
      ) }

      <Section title="Restore upstream">
        <Typography variant="caption" color="text.secondary" sx={ { display: 'block', mb: 1 } }>
          Replace Nightstand with the current upstream free-sleep build.
        </Typography>
        <RevertToStockRow runningVersion={ running }/>
      </Section>
    </PageContainer>
  );
}
