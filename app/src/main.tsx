import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from './theme';

import ControlTempPage from './pages/ControlTempPage/ControlTempPage';
import BaseControlPage from './pages/BaseControlPage/BaseControlPage';
import SettingsPage from './pages/SettingsPage/SettingsPage';
import Layout from './components/Layout';
import { AppStoreProvider } from '@state/appStore.tsx';
import SchedulePage from './pages/SchedulePage/SchedulePage.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { GlobalStyles } from '@mui/material';
import SleepPage from './pages/DataPage/SleepPage/SleepPage.tsx';
import DataPage from './pages/DataPage/DataPage.tsx';
import VitalsPage from './pages/DataPage/VitalsPage/VitalsPage.tsx';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';
import LogsPage from './pages/DataPage/LogsPage/LogsPage.tsx';
import ChangelogPage from './pages/DataPage/ChangelogPage/ChangelogPage.tsx';
import VersionsPage from './pages/SettingsPage/VersionsPage/VersionsPage.tsx';
import StatusPage from './pages/StatusPage/StatusPage.tsx';

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
            <BrowserRouter basename="/">
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
  return worker.start();
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
