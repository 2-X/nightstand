import { useEffect } from 'react';
import Button from '@mui/material/Button';
import { Alert, Box, Typography } from '@mui/material';

import AlarmDismissal from './AlarmDismissal.tsx';
import UpcomingNight from './UpcomingNight.tsx';
import PageHeader from '@components/PageHeader';
import BedTabs from '@components/BedTabs';
import ErrorBoundary from '@components/ErrorBoundary.tsx';
import LastNightChip from './LastNightChip.tsx';
import PageContainer from '../PageContainer.tsx';
import PowerButton from './PowerButton.tsx';
import ScheduleOverrideBanner from './ScheduleOverrideBanner.tsx';
import SideControl from '../../components/SideControl.tsx';
import Slider from './Slider.tsx';
import WaterNotification from './WaterNotification.tsx';
import { useAppStore } from '@state/appStore.tsx';
import { useControlTempStore } from './controlTempStore.tsx';
import { useDeviceStatus } from '@api/deviceStatus';
import { useSettings } from '@api/settings.ts';

export default function ControlTempPage() {
  const { isError, refetch, data: deviceStatus } = useDeviceStatus();
  const syncFromServer = useControlTempStore((state) => state.syncFromServer);
  const { data: settings, isError: settingsError } = useSettings();
  const { isUpdating, side } = useAppStore();

  const sideStatus = deviceStatus?.[side];
  const isOn = sideStatus?.isOn || false;

  useEffect(() => {
    refetch();
  }, [side]);

  useEffect(() => {
    if (!deviceStatus) return;
    syncFromServer(deviceStatus);
  }, [deviceStatus, syncFromServer]);

  return (
    <PageContainer>
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
        <Box sx={ { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 } }>
          <SideControl compact={ false } />
          { !sideStatus && !isError && (
            <Typography role="status">
              { deviceStatus ? 'Bed status unavailable. Refresh to try again.' : 'Loading bed status...' }
            </Typography>
          ) }
          { sideStatus && (
            <Slider
              isOn={ isOn }
              statusUnavailable={ isError }
              currentTargetTemp={ sideStatus.targetTemperatureF }
              refetch={ refetch }
              currentTemperatureF={ sideStatus.currentTemperatureF }
              format={ settings?.temperatureFormat ?? 'fahrenheit' }
            />
          ) }

          { isError && <Alert severity="error">Could not load bed status.</Alert> }
          { isError || (deviceStatus && !sideStatus) ? (
            <Button variant="contained" onClick={ () => refetch() } disabled={ isUpdating }>
              Try again
            </Button>
          ) : (
            sideStatus && <PowerButton isOn={ sideStatus.isOn } refetch={ refetch } />
          ) }
        </Box>
        <Box sx={ { display: 'flex', flexDirection: 'column', gap: 2, width: '100%' } }>
          <ErrorBoundary componentName="Schedule override banner">
            <ScheduleOverrideBanner />
          </ErrorBoundary>
          <WaterNotification />
          <ErrorBoundary componentName="Alarm notification">
            <UpcomingNight isOn={ isOn } />
          </ErrorBoundary>
          <ErrorBoundary componentName="Last night chip">
            <LastNightChip />
          </ErrorBoundary>
        </Box>
      </Box>
      <AlarmDismissal refetch={ refetch } />
    </PageContainer>
  );
}
