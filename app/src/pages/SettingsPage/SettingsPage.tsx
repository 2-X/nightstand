import { useState } from 'react';
import semver from 'semver';
import { useLatestVersion } from '@api/useLatestVersion.ts';
import { DeepPartial } from 'ts-essentials';
import { Alert, Box, Button, CircularProgress, List, ListItemButton, ListItemText, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { SETTINGS_CATEGORIES } from './settingsCategories';
import SideSettings from './SideSettings.tsx';
import { SubpageShell } from '../DataPage/Header.tsx';
import { useServices } from '@api/services.ts';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { useStatusSummary } from '../StatusPage/useStatusSummary';
import { Settings } from '@api/settingsSchema.ts';
import { postSettings, useSettings } from '@api/settings.ts';
import { useAppStore } from '@state/appStore.tsx';
import DailyPriming from './DailyPriming.tsx';
import LicenseModal from './LicenseModal.tsx';
import PrimeControl from './PrimeControl.tsx';
import FeaturesSection from './FeaturesSection/FeaturesSection.tsx';
import Section from './Section.tsx';
import StorageIndicator from './StorageIndicator.tsx';
import MemoryIndicator from './MemoryIndicator.tsx';
import ErrorBoundary from '@components/ErrorBoundary.tsx';
import TimeZoneSelector from './DeviceSettingsSection/TimeZoneSelector.tsx';
import TemperatureFormatSelector from './DeviceSettingsSection/TemperatureFormatSelector.tsx';
import LedBrightnessSlider from './DeviceSettingsSection/LedBrightnessSlider.tsx';
import RawArchiveRetention from './DeviceSettingsSection/RawArchiveRetention.tsx';
import DailyReboot from './DeviceSettingsSection/DailyReboot.tsx';
import DeviceInfo from './DeviceSettingsSection/DeviceInfo.tsx';

export default function SettingsPage() {
  const { data: settings, refetch, isLoading, isError } = useSettings();
  const { setIsUpdating } = useAppStore();
  const [error, setError] = useState<string | null>(null);
  const { pathname } = useLocation();
  const category = pathname.split('/')[2] ?? '';
  const { data: services } = useServices();
  const { data: device } = useDeviceStatus();
  const latestVersion = useLatestVersion();
  const runningVersion = device?.freeSleep?.version;
  const updateAvailable = runningVersion && latestVersion && semver.valid(runningVersion) && semver.valid(latestVersion)
    && semver.gt(latestVersion, runningVersion);
  const { isError: statusError, attention, keys: statusKeys, coreReady } = useStatusSummary();
  const biometricsEnabled = !!services?.biometrics?.enabled;
  const biometricsInstalled = services?.biometrics?.jobs?.installation?.status === 'healthy';
  const enabledFeatures = [biometricsEnabled && settings?.features?.sleepScore, biometricsEnabled && settings?.features?.presenceAutoOff,
    settings?.features?.levelTemps, settings?.features?.oneOffAlarms, biometricsInstalled && biometricsEnabled].filter(Boolean).length;
  const zoneNames: Record<string, string> = { 'America/Los_Angeles': 'Pacific', 'America/Denver': 'Mountain',
    'America/Chicago': 'Central', 'America/New_York': 'Eastern' };
  const zone = settings?.timeZone && (zoneNames[settings.timeZone] ?? settings.timeZone.split('/').pop()?.replace(/_/g, ' '));
  const format = settings?.temperatureFormat === 'level' ? 'Level scale' : settings?.temperatureFormat === 'celsius' ? 'Celsius' : 'Fahrenheit';
  const issueCount = attention.length;
  const details: Record<string, string> = {
    bed: settings ? `${settings.left.name}, ${settings.right.name} · ${format} · ${zone} time` : 'Names, away mode, units and priming',
    features: settings && services ? `${enabledFeatures} of 5 on` : 'Optional sleep and bed controls',
    versions: `${runningVersion ? `v${runningVersion} · ` : ''}${updateAvailable ? 'Update available · ' : ''}Updates and recovery`,
    device: statusError ? 'Status unavailable' : issueCount ? `${issueCount} items need attention`
      : coreReady ? 'Everything running' : statusKeys.length ? 'Waiting for core services' : 'System status, logs and restart',
  };
  const categories = SETTINGS_CATEGORIES.map(item => ({ ...item, detail: details[item.key] }));
  const selected = category === 'about' ? { title: 'About and license' } : categories.find((item) => item.key === category);
  const updateSettings = (patch: DeepPartial<Settings>) => {
    setError(null);
    setIsUpdating(true);
    postSettings(patch)
      .then(() => refetch())
      .catch(() => {
        setError('Could not save settings. Your previous settings are still active. Try the change again.');
      })
      .finally(() => setIsUpdating(false));
  };

  if (category && !selected) return <Navigate to="/settings" replace />;

  return (
    <SubpageShell title={ selected?.title ?? 'Settings' } backTo={ category ? '/settings' : '' }>
      { error && (
        <Alert severity="error" onClose={ () => setError(null) }>
          { error }
        </Alert>
      ) }
      { isError && (
        <Alert severity="error" action={ <Button onClick={ () => refetch() }>Retry</Button> }>
          Could not load settings.
        </Alert>
      ) }
      { isLoading && category && <CircularProgress aria-label="Loading settings" /> }
      { !selected && (
        <List disablePadding sx={ { bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' } }>
          { categories.map((item) => (
            <ListItemButton
              key={ item.key }
              component={ Link }
              to={ `/settings/${item.key}` }
              sx={ { py: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } } }
            >
              <ListItemText
                primary={ item.title }
                secondary={ item.detail }
                slotProps={ { secondary: { color: item.key === 'device' && issueCount ? 'warning.main' : 'text.secondary' } } } />
              <ChevronRightIcon color="action" />
            </ListItemButton>
          )) }
        </List>
      ) }
      { !selected && <Button component={ Link } to="/settings/about" sx={ { alignSelf: 'flex-start' } }>About and license</Button> }
      { category === 'bed' && (
        <>
          <ErrorBoundary componentName="Side settings">
            <Section title="Side settings">
              <SideSettings side="left" settings={ settings } updateSettings={ updateSettings } />
              <Box sx={ { my: 3, borderTop: 1, borderColor: 'divider' } } />
              <SideSettings side="right" settings={ settings } updateSettings={ updateSettings } />
              <Typography variant="body2" color="text.secondary" sx={ { mt: 2 } }>
                Away mode pauses that side's schedules and mirrors the active side. If both sides are away, neither
                schedule runs.
              </Typography>
            </Section>
          </ErrorBoundary>
          <ErrorBoundary componentName="Bed preferences">
            <Section>
              <TimeZoneSelector settings={ settings } updateSettings={ updateSettings } />
              <TemperatureFormatSelector settings={ settings } updateSettings={ updateSettings } />
              <LedBrightnessSlider />
            </Section>
          </ErrorBoundary>

          <ErrorBoundary componentName="Priming settings">
            <Section title="Priming">
              <DailyPriming settings={ settings } updateSettings={ updateSettings } />
              <PrimeControl />
              <Typography variant="body2" color="text.secondary" sx={ { mt: 2 } }>
                Prime while the bed is empty to help circulate water and clear air.
              </Typography>
            </Section>
          </ErrorBoundary>
        </>
      ) }
      { category === 'features' && (
        <>
          <ErrorBoundary componentName="Features section">
            <FeaturesSection />
          </ErrorBoundary>
          <ErrorBoundary componentName="Data retention">
            <Section>
              <RawArchiveRetention settings={ settings } updateSettings={ updateSettings } />
            </Section>
          </ErrorBoundary>
        </>
      ) }
      { category === 'device' && (
        <>
          <List disablePadding sx={ { bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' } }>
            { [['system', 'System status'], ['logs', 'Logs'], ['versions', 'Software and updates']].map(([key, label]) => (
              <ListItemButton key={ key } component={ Link } to={ `/settings/${key}` } sx={ { minHeight: 48 } }>
                <ListItemText primary={ label }/><ChevronRightIcon color="action"/>
              </ListItemButton>
            )) }
          </List>
          <ErrorBoundary componentName="Device info">
            <Section>
              <DeviceInfo />
            </Section>
          </ErrorBoundary>
          <Section title="Maintenance">
            <DailyReboot settings={ settings } updateSettings={ updateSettings } />
          </Section>
          <ErrorBoundary componentName="Storage indicator">
            <Section>
              <StorageIndicator />
              <MemoryIndicator />
            </Section>
          </ErrorBoundary>
        </>
      ) }
      { category === 'about' && (
        <Section>
          <Typography sx={ { mb: 2 } }>
            Nightstand is a community project based on free-sleep. It is not affiliated with Eight Sleep.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Thanks to the free-sleep and Eight Sleep Jailbreak contributors.
          </Typography>
          <Button component={ Link } to="/changelog">
            Release notes
          </Button>
          <LicenseModal />
        </Section>
      ) }
    </SubpageShell>
  );
}
