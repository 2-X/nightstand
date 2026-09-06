import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import RouteFallback from './components/RouteFallback.tsx';

// Pages are lazy-loaded so each route ships only what it needs. The shell
// (Layout, AppStoreProvider, theme, query client) stays in the entry chunk so
// the first paint doesn't wait on a route-specific download.
const TonightPage = lazy(() => import('./pages/TonightPage/TonightPage'));
const AlarmsPage = lazy(() => import('./pages/AlarmsPage/AlarmsPage'));
const ControlTempPage = lazy(() => import('./pages/ControlTempPage/ControlTempPage'));
const BaseControlPage = lazy(() => import('./pages/BaseControlPage/BaseControlPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage/SettingsPage'));
const SchedulePage = lazy(() => import('./pages/SchedulePage/SchedulePage.tsx'));
const SleepPage = lazy(() => import('./pages/DataPage/SleepPage/SleepPage.tsx'));
const DataPage = lazy(() => import('./pages/DataPage/DataPage.tsx'));
const VitalsPage = lazy(() => import('./pages/DataPage/VitalsPage/VitalsPage.tsx'));
const LogsPage = lazy(() => import('./pages/DataPage/LogsPage/LogsPage.tsx'));
const ChangelogPage = lazy(() => import('./pages/DataPage/ChangelogPage/ChangelogPage.tsx'));
const VersionsPage = lazy(() => import('./pages/SettingsPage/VersionsPage/VersionsPage.tsx'));
const StatusPage = lazy(() => import('./pages/StatusPage/StatusPage.tsx'));

export default function AppRoutes() {
  return (
    <Suspense fallback={ <RouteFallback /> }>
      <Routes>
        <Route path="/" element={ <Layout/> }>
          <Route index element={ <TonightPage/> }/>
          <Route path="control" element={ <ControlTempPage/> }/>
          <Route path="alarms" element={ <AlarmsPage/> }/>
          <Route path="temperature" element={ <ControlTempPage/> }/>
          <Route path="left" element={ <ControlTempPage/> }/>
          <Route path="right" element={ <ControlTempPage/> }/>
          <Route path="status" element={ <StatusPage /> } />
          <Route path="elevation" element={ <BaseControlPage/> }/>

          <Route path="data" element={ <DataPage /> }>
            <Route path="sleep" element={ <SleepPage/> }/>
            <Route path="logs" element={ <LogsPage/> }/>
            <Route path="vitals" element={ <VitalsPage/> }/>
          </Route>

          <Route path="changelog" element={ <ChangelogPage/> }/>

          { /* Not yet linked from Settings: the channel picker and
               per-release install need a real releases.json history,
               which this tree does not have with only one release
               published so far. Reachable by URL so the code
               stays real and tested rather than a stub. */ }
          <Route path="settings/versions" element={ <VersionsPage/> }/>

          <Route path="settings" element={ <SettingsPage/> }/>
          <Route path="schedules" element={ <SchedulePage/> }/>
        </Route>
      </Routes>
    </Suspense>
  );
}
