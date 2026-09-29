import { Suspense, useLayoutEffect, useRef } from 'react';
import RouteFallback from './RouteFallback';
import ErrorBoundary from './ErrorBoundary';
import { useScheduleStore } from '../pages/SchedulePage/scheduleStore';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import Box from '@mui/material/Box';


export default function Layout() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  useLayoutEffect(() => {
    if (previousPath.current === '/schedules' && pathname !== '/schedules') {
      useScheduleStore.getState().reloadScheduleData();
    }
    previousPath.current = pathname;
  }, [pathname]);
  const pageName = pathname === '/schedules' ? 'Schedule'
    : pathname.includes('logs') ? 'Logs' : pathname === '/changelog' ? 'Release notes'
      : pathname.startsWith('/settings') ? 'Settings' : 'Page';
  return (
    <Box
      id="Layout"
      sx={ {
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        alignItems: 'center',
        gap: 2,
        // padding: 0,
        margin: 0,
        justifyContent: 'flex-start',
        pt: { xs: 1, md: 10 },
        pb: { xs: 'calc(80px + env(safe-area-inset-bottom, 0px))', md: 4 },
        minHeight: '100dvh',
      } }
    >
      { /* Renders current route */ }
      <ErrorBoundary key={ pathname } componentName={ pageName }>
        <Suspense fallback={ <RouteFallback/> }><Outlet/></Suspense>
      </ErrorBoundary>
      <Navbar/>
    </Box>
  );
}
