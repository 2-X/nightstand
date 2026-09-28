import { useEffect } from 'react';
import Button from '@mui/material/Button';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { palette } from '@design/tokens';

import AlarmDismissal from './AlarmDismissal.tsx';
import UpcomingNight from './UpcomingNight.tsx';
import Clock from '@components/Clock.tsx';
import BedTabs from '@components/BedTabs';
import ErrorBoundary from '@components/ErrorBoundary.tsx';
import LastNightChip from './LastNightChip.tsx';
import PageContainer from '../PageContainer.tsx';
import PowerButton from './PowerButton.tsx';
import PrimingNotification from './PrimingNotification.tsx';
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
  const { data: settings } = useSettings();
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
    <PageContainer sx={ { maxWidth: '840px', alignItems: 'center' } }>
      <Box
        sx={ {
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          width: '100%',
          px: 0.5,
          mt: 1,
        } }
      >
        <Typography
          component="h1"
          sx={ {
            fontSize: '1.75rem',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: palette.text.primary,
          } }
        >
          Bed
        </Typography>
        <ErrorBoundary componentName="Clock">
          <Clock />
        </ErrorBoundary>
      </Box>

      <SideControl compact={ false } />
      <BedTabs />
      <Box
        sx={ {
          display: 'grid',
          width: '100%',
          gap: 3,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
          alignItems: 'start',
        } }
      >
        <Box sx={ { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 } }>
          { !sideStatus && !isError && (
            <Typography role="status">
              { deviceStatus ? 'Bed status unavailable. Refresh to try again.' : 'Loading bed status...' }
            </Typography>
          ) }
          { sideStatus && (
            <Slider
              isOn={ isOn }
              currentTargetTemp={ sideStatus?.targetTemperatureF || 55 }
              refetch={ refetch }
              currentTemperatureF={ sideStatus?.currentTemperatureF || 55 }
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
        <Box sx={ { display: 'flex', flexDirection: 'column', gap: 1, width: '100%' } }>
          <ErrorBoundary componentName="Schedule override banner">
            <ScheduleOverrideBanner />
          </ErrorBoundary>
          { deviceStatus?.isPriming && <PrimingNotification /> }
          <ErrorBoundary componentName="Alarm notification">
            <UpcomingNight />
          </ErrorBoundary>
          <WaterNotification />
          <ErrorBoundary componentName="Last night chip">
            <LastNightChip />
          </ErrorBoundary>
        </Box>
      </Box>
      <AlarmDismissal refetch={ refetch } />
      { isUpdating && <CircularProgress /> }
    </PageContainer>
  );
}
