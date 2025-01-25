import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import ControlTempPage from './pages/ControlTempPage/ControlTempPage';
import SettingsPage from './pages/SettingsPage/SettingsPage';
import Layout from './components/Layout';
import { AppStoreProvider } from '@state/appStore.tsx';
import SchedulePage from './pages/SchedulePage/SchedulePage.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { GlobalStyles } from '@mui/material';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#010101'
    },
    text: {
      secondary: '#87868BFF'
    },
    grey: {
      500: '#606060',
      700: '#272727',
      800: '#262626',
    }
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
    },
  },
});


const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={darkTheme}>
        <AppStoreProvider>
          <CssBaseline/>
          <GlobalStyles
            styles={{
              'html, body': {
                overscrollBehavior: 'none', // Prevent rubber-banding
              },
              '.sticky-mask': {
                position: 'fixed',
                top: '-20px',  // Place it slightly outside the viewport
                left: 0,
                width: '100%',
                height: '20px',  // Adjust the height to mask the overscroll
                backgroundColor: '#fff',  // Match background to blend in
                zIndex: 9999,  // Ensure it's above other content
                pointerEvents: 'none',  // Allow interactions to pass through
              },
            }}
          />
          <BrowserRouter basename="/">
            <Routes>
              <Route path="/" element={<Layout/>}>
                <Route index element={<SettingsPage/>}/>
                <Route path="temperature/" element={<ControlTempPage/>}/>
                <Route path="left/" element={<ControlTempPage/>}/>
                <Route path="right/" element={<ControlTempPage/>}/>
                <Route path="settings/" element={<SettingsPage/>}/>
                <Route path="schedules/" element={<SchedulePage/>}/>
              </Route>
            </Routes>
          </BrowserRouter>
        </AppStoreProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
