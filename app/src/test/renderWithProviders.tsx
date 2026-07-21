import { ReactElement } from 'react';
import { render, RenderResult } from '@testing-library/react';
import userEvent, { UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';
import { theme } from '../theme';
import { AppStoreProvider } from '@state/appStore.tsx';

type Options = { initialRoute?: string };

// Mirrors the provider stack in main.tsx so a component under test sees the
// same context it sees in production. A fresh QueryClient per call with retry
// off keeps error path tests fast and stops cache bleed between tests.
export function renderWithProviders(
  ui: ReactElement,
  options: Options = {},
): RenderResult & { user: UserEvent; queryClient: QueryClient } {
  const { initialRoute = '/' } = options;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={ queryClient }>
      <ThemeProvider theme={ theme }>
        <LocalizationProvider dateAdapter={ AdapterMoment }>
          <AppStoreProvider>
            <MemoryRouter initialEntries={ [initialRoute] }>
              { ui }
            </MemoryRouter>
          </AppStoreProvider>
        </LocalizationProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...result, user: userEvent.setup(), queryClient };
}
