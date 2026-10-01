import { useState } from 'react';
import { isAxiosError } from 'axios';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, CircularProgress, Link, Typography } from '@mui/material';
import Section from '../Section.tsx';
import RawArchiveRetention from '../DeviceSettingsSection/RawArchiveRetention';
import FeatureToggleRow from './FeatureToggleRow.tsx';
import DisableRhythmsDialog from './DisableRhythmsDialog.tsx';
import EnableRhythmsDialog from './EnableRhythmsDialog.tsx';
import { Services, useServices, postServices } from '@api/services.ts';
import { useSettings, postSettings } from '@api/settings.ts';
import { Settings } from '@api/settingsSchema.ts';
import { useAppStore } from '@state/appStore.tsx';
import { DeepPartial } from 'ts-essentials';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

export default function FeaturesSection() {
  const [error, setError] = useState<string | null>(null);
  const { data: services, refetch: refetchServices, isLoading: servicesLoading, isError: servicesError } = useServices();
  const { data: settings, refetch: refetchSettings, isLoading: settingsLoading, isError: settingsError } = useSettings();
  const setIsUpdating = useAppStore((state) => state.setIsUpdating);
  const isUpdating = useAppStore((state) => state.isUpdating);
  const [rhythmsDialog, setRhythmsDialog] = useState<'enable' | 'disable'>();
  const [rhythmsMessage, setRhythmsMessage] = useState<{ text: string; severity: 'success' | 'warning' }>();

  const updateServices = (services: DeepPartial<Services>) => {
    setError(null);
    setIsUpdating(true);

    postServices(services)
      .then(() => refetchServices())
      .catch((error) => {
        console.error(error);
        const status = isAxiosError(error) ? error.response?.status : undefined;
        const message = status && status >= 500 && status < 600 ? error.response?.data?.error : undefined;
        setError(typeof message === 'string' && message.trim() ? message : 'Could not save this change. Try again.');
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

  if (servicesError || settingsError) return <Alert
    severity="warning"
    action={ <Button onClick={ () => { void refetchServices(); void refetchSettings(); } }>Retry</Button> }>
    Could not load features.
  </Alert>;
  if (servicesLoading || settingsLoading || !services || !settings) return <CircularProgress />;

  // A degraded response (partially written db, a proxy error page, version
  // skew) can arrive with pieces missing. Read every field defensively so the
  // section renders as off and untouchable instead of throwing out of render.
  const features = settings.features;
  const biometricsEnabled = services.biometrics?.enabled ?? false;
  const biometricsInstalled = services.biometrics?.jobs?.installation?.status === 'healthy';

  return (
    <Section>
      { error && (
        <Alert severity="error" onClose={ () => setError(null) }>
          { error }
        </Alert>
      ) }
      <Box id="biometrics" />
      <FeatureToggleRow
        label="Biometrics"
        disabled={ isUpdating || !biometricsInstalled }
        checked={ biometricsEnabled }
        onChange={ (next) => updateServices({ biometrics: { enabled: next } }) }
        description={
          biometricsInstalled ? 'Estimates sleep stages and heart rate on the Pod.'
            : 'Not installed. Optional sleep and vital estimates.'
        }
      />
      { biometricsEnabled && <Box sx={ { pl: 2, my: 2, borderLeft: 1, borderColor: 'divider' } }>
        <RawArchiveRetention
          settings={ settings }
          updateSettings={ patch => {
            setError(null);
            setIsUpdating(true);
            postSettings(patch).then(() => refetchSettings())
              .catch(() => setError('Could not save this change. Try again.'))
              .finally(() => setIsUpdating(false));
          } } />
      </Box> }
      { !biometricsInstalled && <Accordion disableGutters>
        <AccordionSummary expandIcon={ <ExpandMoreIcon/> }>How to install</AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2">Run this command over SSH, then enable Biometrics here.</Typography>
          <Box component="code" sx={ { display: 'block', overflowWrap: 'anywhere', my: 1 } }>
                sh /home/dac/free-sleep/scripts/enable_biometrics.sh
          </Box>
          <Button
            onClick={ async () => {
              try { await navigator.clipboard.writeText('sh /home/dac/free-sleep/scripts/enable_biometrics.sh'); }
              catch { setError('Could not copy the command. Select and copy it above.'); }
            } }>Copy command</Button>
        </AccordionDetails>
      </Accordion> }
      <Box sx={ { pl: 2, borderLeft: 1, borderColor: 'divider' } }>
        <FeatureToggleRow
          label="Sleep score and stages"
          disabled={ isUpdating || features?.sleepScore === undefined || !biometricsEnabled }
          checked={ features?.sleepScore ?? false }
          onChange={ (next) => updateFeature({ sleepScore: next }) }
          description={
            !biometricsEnabled
              ? <Link href="#biometrics" sx={ { display: 'inline-flex', minHeight: 44, alignItems: 'center' } }>Needs Biometrics</Link>
              : 'The estimated sleep score and sleep-stages chart on the Sleep page.'
          }
        />
      </Box>
      <Box sx={ { pl: 2, borderLeft: 1, borderColor: 'divider' } }>
        <FeatureToggleRow
          label="Presence auto-off"
          disabled={ isUpdating || features?.presenceAutoOff === undefined || !biometricsEnabled }
          checked={ features?.presenceAutoOff ?? false }
          onChange={ (next) => updateFeature({ presenceAutoOff: next }) }
          description={
            !biometricsEnabled
              ? <Link href="#biometrics" sx={ { display: 'inline-flex', minHeight: 44, alignItems: 'center' } }>Needs Biometrics</Link>
              : 'Turns a side off after 45 minutes with no one on it. Never during a scheduled on-window or in away mode.'
          }
        />
      </Box>
      <Box sx={ { pl: 2, borderLeft: 1, borderColor: 'divider' } }>
        <FeatureToggleRow
          label="New sleep tracking (beta)"
          disabled={ isUpdating || features?.biometricsV2 === undefined || !biometricsEnabled }
          checked={ features?.biometricsV2 ?? false }
          onChange={ (next) => updateFeature({ biometricsV2: next }) }
          description={
            !biometricsEnabled
              ? <Link href="#biometrics" sx={ { display: 'inline-flex', minHeight: 44, alignItems: 'center' } }>Needs Biometrics</Link>
              : 'Tells the two sides apart with the bed\'s capacitance sensors. Still being tested.'
          }
        />
      </Box>
      <FeatureToggleRow
        label="Level temperature display"
        disabled={ isUpdating || features?.levelTemps === undefined }
        checked={ features?.levelTemps ?? false }
        onChange={ (next) => updateFeature({ levelTemps: next }) }
        description="Show the -10 to +10 scale as a temperature option."
      />
      <FeatureToggleRow
        label="One-time alarm"
        disabled={ isUpdating || features?.oneOffAlarms === undefined }
        checked={ features?.oneOffAlarms ?? false }
        onChange={ (next) => updateFeature({ oneOffAlarms: next }) }
        description="Adds a one-time alarm to Schedule, separate from the daily wake-up."
      />
      <FeatureToggleRow
        label="Rhythms (beta)"
        ariaLabel="Rhythms"
        disabled={ isUpdating || !features }
        checked={ features?.rhythms ?? false }
        onChange={ (next) => {
          setRhythmsMessage(undefined);
          setRhythmsDialog(next ? 'enable' : 'disable');
        } }
        description={ 'Plan sleep by day and date, with an optional smart temperature curve. '
          + 'Your weekly schedule is kept and comes back if you turn this off.' }
      />
      { rhythmsMessage && <Alert severity={ rhythmsMessage.severity } onClose={ () => setRhythmsMessage(undefined) }>
        { rhythmsMessage.text }
      </Alert> }
      { rhythmsDialog === 'enable' && <EnableRhythmsDialog
        onClose={ () => setRhythmsDialog(undefined) }
        onDone={ text => setRhythmsMessage({ text, severity: 'success' }) }/> }
      { rhythmsDialog === 'disable' && <DisableRhythmsDialog
        onClose={ () => setRhythmsDialog(undefined) }
        onDone={ (text, severity) => setRhythmsMessage({ text, severity }) }/> }
    </Section>
  );
}
