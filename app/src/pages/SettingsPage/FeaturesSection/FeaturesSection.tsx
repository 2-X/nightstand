import { useState } from 'react';
import { Alert, CircularProgress, Typography } from '@mui/material';
import Section from '../Section.tsx';
import FeatureToggleRow from './FeatureToggleRow.tsx';
import { Services, useServices, postServices } from '@api/services.ts';
import { useSettings, postSettings } from '@api/settings.ts';
import { Settings } from '@api/settingsSchema.ts';
import { useAppStore } from '@state/appStore.tsx';
import { DeepPartial } from 'ts-essentials';
import { palette } from '@design/tokens';

export default function FeaturesSection({ group }: { group: 'sleep' | 'automation' | 'bed' }) {
  const [error, setError] = useState<string | null>(null);
  const { data: services, refetch: refetchServices, isLoading: servicesLoading } = useServices();
  const { data: settings, refetch: refetchSettings, isLoading: settingsLoading } = useSettings();
  const setIsUpdating = useAppStore((state) => state.setIsUpdating);
  const isUpdating = useAppStore((state) => state.isUpdating);

  const updateServices = (services: DeepPartial<Services>) => {
    setError(null);
    setIsUpdating(true);

    postServices(services)
      .then(() => refetchServices())
      .catch((error) => {
        console.error(error);
        setError('Could not save this change. Try again.');
      })
      .finally(() => setIsUpdating(false));
  };

  const updateFeature = (features: DeepPartial<Settings['features']>) => {
    setError(null);
    setIsUpdating(true);

    postSettings({ features })
      .then(() => refetchSettings())
      .catch((error) => {
        console.error(error);
        setError('Could not save this change. Try again.');
      })
      .finally(() => setIsUpdating(false));
  };

  if (servicesLoading || settingsLoading || !services || !settings) return <CircularProgress />;

  // A degraded response (partially written db, a proxy error page, version
  // skew) can arrive with pieces missing. Read every field defensively so the
  // section renders as off and untouchable instead of throwing out of render.
  const features = settings.features;
  const biometricsEnabled = services.biometrics?.enabled ?? false;
  const biometricsInstalled = services.biometrics?.jobs?.installation?.status === 'healthy';

  return (
    <Section title="Features">
      { error && (
        <Alert severity="error" onClose={ () => setError(null) }>
          { error }
        </Alert>
      ) }
      { (group === 'sleep') && (
        <>
          <FeatureToggleRow
            label="Biometrics"
            disabled={ isUpdating || !biometricsInstalled }
            checked={ biometricsEnabled }
            onChange={ (next) => updateServices({ biometrics: { enabled: next } }) }
            description={
              biometricsInstalled ? (
                'Process sleep and vital estimates locally on the Pod.'
              ) : (
                <>
                  Install the optional biometrics service over SSH, then enable it here.
                  <Typography
                    component="span"
                    sx={ {
                      display: 'block',
                      mt: 0.5,
                      fontFamily: 'monospace',
                      fontSize: '0.875rem',
                      color: palette.text.secondary,
                    } }
                  >
                    sh /home/dac/free-sleep/scripts/enable_biometrics.sh
                  </Typography>
                </>
              )
            }
          />
          <FeatureToggleRow
            label="Sleep score and stages"
            disabled={ isUpdating || !features || !biometricsEnabled }
            checked={ features?.sleepScore ?? false }
            onChange={ (next) => updateFeature({ sleepScore: next }) }
            description={
              !biometricsEnabled
                ? 'Enable Biometrics in Settings > Sleep data > Features.'
                : 'The estimated sleep score and sleep-stages chart on the Sleep page.'
            }
          />
        </>
      ) }
      { (group === 'automation') && (
        <FeatureToggleRow
          label="Presence auto-off"
          disabled={ isUpdating || !features || !biometricsEnabled }
          checked={ features?.presenceAutoOff ?? false }
          onChange={ (next) => updateFeature({ presenceAutoOff: next }) }
          description={
            !biometricsEnabled
              ? 'Enable Biometrics in Settings > Sleep data > Features.'
              : 'Turns a side off after 45 minutes with no one on it. Never during a scheduled on-window or in away mode.'
          }
        />
      ) }
      { (group === 'bed') && (
        <FeatureToggleRow
          label="Level temperature display"
          disabled={ isUpdating || !features }
          checked={ features?.levelTemps ?? false }
          onChange={ (next) => updateFeature({ levelTemps: next }) }
          description="Adds a -10 to +10 option to the temperature units picker."
        />
      ) }
      { (group === 'automation') && (
        <FeatureToggleRow
          label="One-off alarms"
          disabled={ isUpdating || !features }
          checked={ features?.oneOffAlarms ?? false }
          onChange={ (next) => updateFeature({ oneOffAlarms: next }) }
          description="The single-fire alarm section on the Schedules page, separate from the recurring per-day alarm."
        />
      ) }
    </Section>
  );
}
