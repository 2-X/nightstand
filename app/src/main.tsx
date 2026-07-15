import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from './theme';

import Layout from './components/Layout';
import { AppStoreProvider } from '@state/appStore.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import RouteFallback from './components/RouteFallback.tsx';
import { GlobalStyles } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';

// Pages are lazy-loaded so each route ships only what it needs. The shell
// (Layout, AppStoreProvider, theme, query client) stays in the entry chunk so
// the first paint doesn't wait on a route-specific download.
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
    },
  },
});

const App = () => {
  return (

    <QueryClientProvider client={ queryClient }>
      <ThemeProvider theme={ theme }>
        <LocalizationProvider dateAdapter={ AdapterMoment }>

          <AppStoreProvider>
            <CssBaseline/>
            <GlobalStyles
              styles={ {
                // Split html / body styles deliberately. Applying
                // overscroll-behavior:none to BOTH made Android Chrome create
                // two nested scroll containers: single-finger drag would
                // scroll one and require two fingers for the other. body is
                // the single scroll container that gets the rubber-banding
                // fix; html stays untouched.
                'body': {
                  overscrollBehavior: 'none',
                },
              } }
            />
            { /* BASE_URL is '/' in normal builds; the hosted demo is served
                 from a subpath (GitHub Pages), where Vite sets it via --base. */ }
            <BrowserRouter basename={ import.meta.env.BASE_URL }>
              <Suspense fallback={ <RouteFallback /> }>
                <Routes>
                  <Route path="/" element={ <Layout/> }>
                    <Route index element={ <ControlTempPage/> }/>
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
            </BrowserRouter>
          </AppStoreProvider>
        </LocalizationProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};


async function enableMocking() {
  if (import.meta.env.VITE_ENV !== 'demo') {
    return;
  }
  // eslint-disable-next-line no-console
  console.info('Enabling MSW worker!');

  const { worker } = await import('./mocks/browser');

  // `worker.start()` returns a Promise that resolves
  // once the Service Worker is up and ready to intercept requests.
  // The worker script lives at the app's base path, which is only '/'
  // when the demo isn't hosted under a subpath.
  return worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  });
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary componentName='App'>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
});
