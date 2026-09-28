import { useState } from 'react';
import { DeepPartial } from 'ts-essentials';
import { Alert, Box, Button, CircularProgress, List, ListItemButton, ListItemText, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Link, Navigate, useLocation } from 'react-router-dom';
import SideSettings from './SideSettings.tsx';
import PageContainer from '../PageContainer.tsx';
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
  const categories = [
    {
      key: 'people',
      title: 'People and sides',
      detail: settings ? `${settings.left.name} / ${settings.right.name}` : 'Names and away mode',
    },
    {
      key: 'bed',
      title: 'Bed preferences',
      detail: settings
        ? `${settings.temperatureFormat} / ${settings.timeZone}`
        : 'Temperature units, timezone and lights',
    },
    { key: 'automation', title: 'Automation', detail: 'Priming, presence auto-off and one-off alarms' },
    { key: 'sleep-data', title: 'Sleep data', detail: 'Biometrics, estimates and data retention' },
    { key: 'device', title: 'Device', detail: 'System status, logs, storage and restart' },
    { key: 'versions', title: 'Software', detail: 'Installed version, updates and recovery' },
    { key: 'about', title: 'About', detail: 'Release notes, credits and license' },
  ];
  const selected = categories.find((item) => item.key === category);
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
    <PageContainer sx={ { gap: 3, alignItems: 'stretch', maxWidth: '720px' } }>
      { category && (
        <Button component={ Link } to="/settings" sx={ { alignSelf: 'flex-start' } }>
          Back to Settings
        </Button>
      ) }
      <Typography component="h1" variant="h1">
        { selected?.title ?? 'Settings' }
      </Typography>
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
        <List disablePadding sx={ { bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2 } }>
          { categories.map((item) => (
            <ListItemButton
              key={ item.key }
              component={ Link }
              to={ `/settings/${item.key}` }
              sx={ { py: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } } }
            >
              <ListItemText primary={ item.title } secondary={ item.detail } />
              <ChevronRightIcon color="action" />
            </ListItemButton>
          )) }
        </List>
      ) }
      { category === 'people' && (
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
      ) }
      { category === 'bed' && (
        <>
          <ErrorBoundary componentName="Bed preferences">
            <Section>
              <TimeZoneSelector settings={ settings } updateSettings={ updateSettings } />
              <TemperatureFormatSelector settings={ settings } updateSettings={ updateSettings } />
              <LedBrightnessSlider />
            </Section>
          </ErrorBoundary>
          <ErrorBoundary componentName="Features section">
            <FeaturesSection group="bed" />
          </ErrorBoundary>
        </>
      ) }
      { category === 'automation' && (
        <>
          <ErrorBoundary componentName="Priming settings">
            <Section title="Priming">
              <DailyPriming settings={ settings } updateSettings={ updateSettings } />
              <PrimeControl />
              <Typography variant="body2" color="text.secondary" sx={ { mt: 2 } }>
                Prime while the bed is empty to help circulate water and clear air.
              </Typography>
            </Section>
          </ErrorBoundary>
          <ErrorBoundary componentName="Features section">
            <FeaturesSection group="automation" />
          </ErrorBoundary>
        </>
      ) }
      { category === 'sleep-data' && (
        <>
          <ErrorBoundary componentName="Features section">
            <FeaturesSection group="sleep" />
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
          <Section>
            <Button component={ Link } to="/settings/system">
              System status
            </Button>
            <Button component={ Link } to="/settings/logs">
              Logs
            </Button>
          </Section>
          <ErrorBoundary componentName="Device info">
            <Section>
              <DeviceInfo />
              <DailyReboot settings={ settings } updateSettings={ updateSettings } />
            </Section>
          </ErrorBoundary>
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
    </PageContainer>
  );
}
