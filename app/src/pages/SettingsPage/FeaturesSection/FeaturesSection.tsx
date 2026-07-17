import { CircularProgress, Typography } from '@mui/material';
import Section from '../Section.tsx';
import FeatureToggleRow from './FeatureToggleRow.tsx';
import { Services, useServices, postServices } from '@api/services.ts';
import { useSettings, postSettings } from '@api/settings.ts';
import { Settings } from '@api/settingsSchema.ts';
import { useAppStore } from '@state/appStore.tsx';
import { DeepPartial } from 'ts-essentials';
import { palette } from '@design/tokens';

export default function FeaturesSection() {
  const { data: services, refetch: refetchServices, isLoading: servicesLoading } = useServices();
  const { data: settings, refetch: refetchSettings, isLoading: settingsLoading } = useSettings();
  const setIsUpdating = useAppStore(state => state.setIsUpdating);
  const isUpdating = useAppStore(state => state.isUpdating);

  const updateServices = (services: DeepPartial<Services>) => {
    setIsUpdating(true);

    postServices(services)
      .then(() => refetchServices())
      .catch(error => {
        console.error(error);
      })
      .finally(() => setIsUpdating(false));
  };

  const updateFeature = (features: DeepPartial<Settings['features']>) => {
    setIsUpdating(true);

    postSettings({ features })
      .then(() => refetchSettings())
      .catch(error => {
        console.error(error);
      })
      .finally(() => setIsUpdating(false));
  };

  if (servicesLoading || settingsLoading || !services || !settings) return <CircularProgress />;

  return (
    <Section title='Features'>
      <FeatureToggleRow
        label='Biometrics'
        disabled={ isUpdating || services?.biometrics.jobs.installation.status !== 'healthy' }
        checked={ services.biometrics.enabled }
        onChange={ (next) => updateServices({ biometrics: { enabled: next } }) }
        description={
          <>
            Calculate biometrics for the pod.
            Requires you to run this command on your pod. Once installation completes successfully, you can toggle this on/off.
            <Typography
              component='span'
              sx={ { display: 'block', mt: 0.5, fontFamily: 'monospace', fontSize: '0.8rem', color: palette.text.tertiary } }
            >
              sh /home/dac/free-sleep/scripts/enable_biometrics.sh
            </Typography>
          </>
        }
      />
      <FeatureToggleRow
        label='Sleep score and stages'
        disabled={ isUpdating || !services.biometrics.enabled }
        checked={ settings.features.sleepScore }
        onChange={ (next) => updateFeature({ sleepScore: next }) }
        description={ !services.biometrics.enabled
          ? 'Needs Biometrics turned on above.'
          : 'The Sleep Fitness Score and the sleep-stages chart on the Sleep page.' }
      />
      <FeatureToggleRow
        label='Level temperature display'
        disabled={ isUpdating }
        checked={ settings.features.levelTemps }
        onChange={ (next) => updateFeature({ levelTemps: next }) }
        description='The -10 to +10 level option in the temperature display picker above.'
      />
      <FeatureToggleRow
        label='One-off alarms'
        disabled={ isUpdating }
        checked={ settings.features.oneOffAlarms }
        onChange={ (next) => updateFeature({ oneOffAlarms: next }) }
        description='The single-fire alarm section on the Schedules page, separate from the recurring per-day alarm.'
      />
    </Section>
  );
}
