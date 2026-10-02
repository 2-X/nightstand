import { useEffect } from 'react';
import Button from '@mui/material/Button';
import { Alert, Box, Typography } from '@mui/material';

import AlarmDismissal from './AlarmDismissal.tsx';
import AnalyzeLastNightPrompt from './AnalyzeLastNightPrompt.tsx';
import UpcomingNight from './UpcomingNight.tsx';
import PageHeader from '@components/PageHeader';
import BedTabs from '@components/BedTabs';
import ErrorBoundary from '@components/ErrorBoundary.tsx';
import LastNightChip from './LastNightChip.tsx';
import LastNightSummary from './LastNightSummary.tsx';
import PageContainer from '../PageContainer.tsx';
import PowerRow from './PowerRow.tsx';
import ScheduleOverrideBanner from './ScheduleOverrideBanner.tsx';
import SideControl from '../../components/SideControl.tsx';
import TemperatureDial from './TemperatureDial.tsx';
import WaterNotification from './WaterNotification.tsx';
import { useAppStore } from '@state/appStore.tsx';
import { useControlTempStore } from './controlTempStore.tsx';
import { useLastNight } from './useLastNight.ts';
import { useDeviceStatus } from '@api/deviceStatus';
import { media } from '@design/tokens';
import { useSettings } from '@api/settings.ts';

const pageSx = { [media.short]: { gap: 1, pt: 1 }, [media.tight]: { gap: 0.5, pt: 0.5 } } as const;
const controlColumnSx = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, [media.short]: { gap: 1 }, [media.tight]: { gap: 0.5 },
} as const;

export default function ControlTempPage() {
  const { isError, refetch, data: deviceStatus } = useDeviceStatus();
  const syncFromServer = useControlTempStore((state) => state.syncFromServer);
  const { data: settings, isError: settingsError } = useSettings();
  const { isUpdating, side } = useAppStore();
  const commandError = useControlTempStore((state) => state.commandError);
  const setCommandError = useControlTempStore((state) => state.setCommandError);

  const sideStatus = deviceStatus?.[side];
  const isOn = sideStatus?.isOn || false;
  const lastNight = useLastNight();
  // While off, last night moves up into the stepper's place under the dial.
  const lastNightUnderDial = !!sideStatus && !isOn;

  useEffect(() => {
    refetch();
  }, [side]);

  useEffect(() => {
    setCommandError(undefined);
    return () => setCommandError(undefined);
  }, [side, setCommandError]);

  useEffect(() => {
    if (!deviceStatus) return;
    syncFromServer(deviceStatus);
  }, [deviceStatus, syncFromServer]);

  return (
    <PageContainer sx={ pageSx }>
      <PageHeader title="Bed" status={ deviceStatus?.isPriming ? 'Priming' : undefined }/>
      <BedTabs />
      { settingsError && <Alert severity="warning">
        Bed preferences are unavailable. { settings ? 'Using the last known preferences.' : 'Temperatures are shown in Fahrenheit.' }
      </Alert> }
      <Box
        sx={ {
          display: 'grid',
          width: '100%',
          gap: 2,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
          alignItems: 'start',
        } }
      >
        <Box sx={ controlColumnSx }>
          <SideControl compact={ false } />
          { !sideStatus && !isError && (
            <Typography role="status">
              { deviceStatus ? 'Bed status unavailable. Refresh to try again.' : 'Loading bed status...' }
            </Typography>
          ) }
          { sideStatus && (
            <TemperatureDial
              status={ sideStatus }
              statusUnavailable={ isError }
              refetch={ refetch }
              format={ settings?.temperatureFormat ?? 'fahrenheit' }
              whenOff={ <ErrorBoundary componentName="Last night summary">
                <LastNightSummary lastNight={ lastNight } />
              </ErrorBoundary> }
            />
          ) }

          { isError && <Alert severity="error">Could not load bed status.</Alert> }
          { isError || (deviceStatus && !sideStatus) ? (
            <Button variant="contained" onClick={ () => refetch() } disabled={ isUpdating }>
              Try again
            </Button>
          ) : (
            sideStatus && <PowerRow isOn={ sideStatus.isOn } refetch={ refetch } />
          ) }
          { commandError && <Alert severity="error" sx={ { width: '100%' } }>{ commandError }</Alert> }
        </Box>
        <Box sx={ { display: 'flex', flexDirection: 'column', gap: 2, width: '100%' } }>
          <ErrorBoundary componentName="Schedule override banner">
            <ScheduleOverrideBanner />
          </ErrorBoundary>
          <WaterNotification />
          <ErrorBoundary componentName="Alarm notification">
            <UpcomingNight isOn={ isOn } />
          </ErrorBoundary>
          { !lastNightUnderDial && <ErrorBoundary componentName="Last night chip">
            <LastNightChip lastNight={ lastNight } />
          </ErrorBoundary> }
          <ErrorBoundary componentName="Analyze last night">
            <AnalyzeLastNightPrompt />
          </ErrorBoundary>
        </Box>
      </Box>
      <AlarmDismissal refetch={ refetch } />
    </PageContainer>
  );
}
