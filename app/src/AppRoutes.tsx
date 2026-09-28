import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import SideRoute from './components/SideRoute';
import RouteFallback from './components/RouteFallback.tsx';

// Pages are lazy-loaded so each route ships only what it needs. The shell
// (Layout, AppStoreProvider, theme, query client) stays in the entry chunk so
// the first paint doesn't wait on a route-specific download.
const ControlTempPage = lazy(() => import('./pages/ControlTempPage/ControlTempPage'));
const BaseControlPage = lazy(() => import('./pages/BaseControlPage/BaseControlPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage/SettingsPage'));
const SchedulePage = lazy(() => import('./pages/SchedulePage/SchedulePage.tsx'));
const SleepPage = lazy(() => import('./pages/DataPage/SleepPage/SleepPage.tsx'));
const LogsPage = lazy(() => import('./pages/DataPage/LogsPage/LogsPage.tsx'));
const ChangelogPage = lazy(() => import('./pages/DataPage/ChangelogPage/ChangelogPage.tsx'));
const VersionsPage = lazy(() => import('./pages/SettingsPage/VersionsPage/VersionsPage.tsx'));
const StatusPage = lazy(() => import('./pages/StatusPage/StatusPage.tsx'));

export default function AppRoutes() {
  return (
    <Suspense fallback={ <RouteFallback /> }>
      <Routes>
        <Route path="/" element={ <Layout/> }>
          <Route index element={ <ControlTempPage/> }/>
          <Route path="temperature" element={ <ControlTempPage/> }/>
          <Route path="left" element={ <SideRoute side="left"/> }/>
          <Route path="right" element={ <SideRoute side="right"/> }/>
          <Route path="status" element={ <Navigate to="/settings/system" replace/> }/>
          <Route path="settings/system" element={ <StatusPage/> }/>
          <Route path="elevation" element={ <BaseControlPage/> }/>

          <Route path="sleep" element={ <SleepPage/> }/>
          <Route path="data" element={ <Navigate to="/sleep" replace/> }/>
          <Route path="data/sleep" element={ <Navigate to="/sleep" replace/> }/>
          <Route path="data/vitals" element={ <Navigate to="/sleep?metric=heart_rate" replace/> }/>
          <Route path="data/logs" element={ <Navigate to="/settings/logs" replace/> }/>
          <Route path="settings/logs" element={ <LogsPage/> }/>

          <Route path="changelog" element={ <ChangelogPage/> }/>

          <Route path="settings/versions" element={ <VersionsPage/> }/>

          <Route path="settings/people" element={ <Navigate to="/settings/bed" replace/> }/>
          <Route path="settings/automation" element={ <Navigate to="/settings/bed" replace/> }/>
          <Route path="settings/sleep-data" element={ <Navigate to="/settings/features" replace/> }/>
          <Route path="settings" element={ <SettingsPage/> }/>
          <Route path="settings/:category" element={ <SettingsPage/> }/>
          <Route path="schedules" element={ <SchedulePage/> }/>
        </Route>
      </Routes>
    </Suspense>
  );
}
