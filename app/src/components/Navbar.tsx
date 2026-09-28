import {
  Box,
  Badge,
  BottomNavigation,
  BottomNavigationAction,
  Button,
  LinearProgress,
  Typography,
} from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAppStore } from '@state/appStore.tsx';
import { useUpdateAttentionStore } from '@state/updateAttentionStore';
import { useDeviceStatus } from '@api/deviceStatus';
import { useEventStreamStore } from '@api/eventStream.ts';
import { useStatusSummary } from '../pages/StatusPage/useStatusSummary';
import { PAGES, primaryRoute } from './pages';

export default function Navbar() {
  const { pathname } = useLocation();
  const { isUpdating } = useAppStore();
  const wsState = useEventStreamStore((s) => s.state);
  const { attention } = useStatusSummary();
  const unhealthy = attention.length > 0;
  const updateAttention = useUpdateAttentionStore(state => state.updateAttention);
  const updateStartVersion = useUpdateAttentionStore(state => state.updateStartVersion);
  const setUpdateAttention = useUpdateAttentionStore(state => state.setUpdateAttention);
  const { data: deviceStatus } = useDeviceStatus();
  const runningVersion = deviceStatus?.freeSleep?.version;
  useEffect(() => {
    if (runningVersion && updateStartVersion && runningVersion !== updateStartVersion) setUpdateAttention(false);
  }, [runningVersion, updateStartVersion, setUpdateAttention]);
  const settingsAttention = !!unhealthy || updateAttention;
  const settingsLabel = ['Settings', updateAttention ? 'update needs attention' : '', unhealthy ? 'system needs attention' : '']
    .filter(Boolean).join(', ');
  const selected = primaryRoute(pathname);
  return (
    <>
      { isUpdating && (
        <LinearProgress
          aria-label="Saving changes"
          sx={ { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1300 } }
        />
      ) }
      { wsState === 'reconnecting' && (
        <Box
          role="status"
          sx={ {
            position: 'fixed',
            top: 'calc(8px + env(safe-area-inset-top, 0px))',
            right: 16,
            px: 1,
            bgcolor: 'background.paper',
            color: 'warning.light',
            zIndex: 1202,
          } }
        >
          Reconnecting...
        </Box>
      ) }
      <Box
        component="nav"
        aria-label="Primary desktop"
        sx={ {
          display: { xs: 'none', md: 'flex' },
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 64,
          px: 3,
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: 'background.default',
          borderBottom: 1,
          borderColor: 'divider',
          zIndex: 1100,
        } }
      >
        <Typography sx={ { fontWeight: 600 } }>Nightstand</Typography>
        <Box sx={ { display: 'flex', gap: 1 } }>
          { PAGES.map((page) => (
            <Button
              key={ page.route }
              component={ Link }
              to={ page.route }
              aria-current={ selected === page.route ? 'page' : undefined }
              aria-label={ page.route === '/settings' && settingsAttention ? settingsLabel : undefined }
              variant={ selected === page.route ? 'outlined' : 'text' }
            >
              <Badge color={ unhealthy ? 'error' : 'warning' } variant="dot" invisible={ !(page.route === '/settings' && settingsAttention) }>
                { page.title }
              </Badge>
            </Button>
          )) }
        </Box>
      </Box>
      <BottomNavigation
        component="nav"
        aria-label="Primary mobile"
        showLabels
        value={ selected }
        sx={ {
          display: { xs: 'flex', md: 'none' },
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          height: 'calc(64px + env(safe-area-inset-bottom, 0px))',
          pb: 'env(safe-area-inset-bottom, 0px)',
          bgcolor: 'background.default',
          borderTop: 1,
          borderColor: 'divider',
          zIndex: 1100,
        } }
      >
        { PAGES.map((page) => (
          <BottomNavigationAction
            key={ page.route }
            component={ Link }
            to={ page.route }
            value={ page.route }
            label={ page.title }
            aria-current={ selected === page.route ? 'page' : undefined }
            aria-label={ page.route === '/settings' && settingsAttention ? settingsLabel : undefined }
            icon={
              <Badge color={ unhealthy ? 'error' : 'warning' } variant="dot" invisible={ !(page.route === '/settings' && settingsAttention) }>
                { page.icon }
              </Badge>
            }
            sx={ {
              minWidth: 0,
              flex: 1,
              px: 0.5,
              color: 'text.secondary',
              '& .MuiBottomNavigationAction-label': { fontSize: '0.75rem', '&.Mui-selected': { fontSize: '0.75rem' } },
            } }
          />
        )) }
      </BottomNavigation>
    </>
  );
}
