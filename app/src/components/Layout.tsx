import { Suspense, useLayoutEffect, useRef } from 'react';
import RouteFallback from './RouteFallback';
import ErrorBoundary from './ErrorBoundary';
import { useScheduleStore } from '../pages/SchedulePage/scheduleStore';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import Box from '@mui/material/Box';
import MissedAlarmBanner from './MissedAlarmBanner';
import CoolingNotice from './CoolingNotice';
import DemoBanner from './DemoBanner';
import { isBedPath } from './pageRail';


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
      { /* The bars are fixed, so their place in the markup only decides tab
           order: navigation first, then the page. */ }
      <Box
        component="a"
        href="#main-content"
        onClick={ (event: React.MouseEvent) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        } }
        sx={ {
          position: 'fixed', top: 8, left: 8, zIndex: 1400, px: 2, py: 1, borderRadius: 1,
          display: 'flex', alignItems: 'center', minHeight: 44,
          bgcolor: 'background.paper', color: 'text.primary', border: 1, borderColor: 'divider',
          transform: 'translateY(-200%)', '&:focus': { transform: 'none' },
        } }
      >
        Skip to main content
      </Box>
      <Navbar/>
      <Box
        component="main"
        id="main-content"
        tabIndex={ -1 }
        sx={ { display: 'flex', flexDirection: 'column', flexGrow: 1, alignItems: 'center', gap: 2, width: '100%', outline: 'none' } }
      >
        { import.meta.env.VITE_ENV === 'demo' && <DemoBanner wide={ isBedPath(pathname) }/> }
        <CoolingNotice />
        <MissedAlarmBanner wide={ isBedPath(pathname) }/>
        <ErrorBoundary key={ pathname } componentName={ pageName }>
          <Suspense fallback={ <RouteFallback/> }><Outlet/></Suspense>
        </ErrorBoundary>
      </Box>
    </Box>
  );
}
