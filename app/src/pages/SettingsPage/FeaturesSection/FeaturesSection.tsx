import { CircularProgress, Typography } from '@mui/material';
import Section from '../Section.tsx';
import FeatureToggleRow from './FeatureToggleRow.tsx';
import { Services, useServices, postServices } from '@api/services.ts';
import { useAppStore } from '@state/appStore.tsx';
import { DeepPartial } from 'ts-essentials';
import { palette } from '@design/tokens';

export default function FeaturesSection() {
  const { data: services, refetch, isLoading } = useServices();
  const setIsUpdating = useAppStore(state => state.setIsUpdating);
  const isUpdating = useAppStore(state => state.isUpdating);

  const updateServices = (services: DeepPartial<Services>) => {
    setIsUpdating(true);

    postServices(services)
      .then(() => refetch())
      .catch(error => {
        console.error(error);
      })
      .finally(() => setIsUpdating(false));
  };

  if (isLoading || !services) return <CircularProgress />;

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
    </Section>
  );
}
