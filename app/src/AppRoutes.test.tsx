import { beforeAll, describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import { renderApp, renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';

beforeAll(async () => {
  // Warm the index route's lazy chunk once, up front. On a cold CI runner its
  // transpile cost otherwise lands inside the first render's findAllByText
  // window and can push the first full-app render past the wait timeout while
  // later ones (with the chunk already cached) stay fast.
  await import('./pages/ControlTempPage/ControlTempPage');
}, 30_000);

describe('app navigation and conditional visibility', () => {
  it('shows the Elevation tab when a base is configured', async () => {
    renderApp('/');
    // Default mock reports a configured base. Elevation only appears once
    // useBaseConfigured's query resolves, so findAllByText keeps retrying
    // through that async settle. The timeout is generous to absorb a slow
    // cold render on a loaded CI runner.
    expect(
      (await screen.findAllByText('Elevation', {}, { timeout: 15000 })).length,
    ).toBeGreaterThan(0);
  });

  it('hides the Elevation tab when no base is configured', async () => {
    server.use(
      http.get('/api/base-control', () =>
        HttpResponse.json({
          head: 0,
          feet: 0,
          isMoving: false,
          lastUpdate: new Date().toISOString(),
          isConfigured: false,
        }),
      ),
    );
    const { queryClient } = renderApp('/');
    // Anchor on the always-present Settings item first.
    expect(
      (await screen.findAllByText('Settings', {}, { timeout: 15000 })).length,
    ).toBeGreaterThan(0);
    // Settings renders before the baseConfigured query settles, so wait for
    // that query to actually resolve before asserting Elevation is absent.
    // Without this, the assertion below would pass trivially by racing the
    // fetch, regardless of whether the override above is even wired up right.
    await waitFor(() => {
      expect(queryClient.getQueryState(['baseConfigured'])?.status).toBe('success');
    });
    expect(screen.queryByText('Elevation')).not.toBeInTheDocument();
  });
});

it('redirects an unknown settings category to the index', async () => {
  renderApp('/settings/unknown');
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Back to Settings' })).not.toBeInTheDocument();
});

it.each([
  ['/settings/bed', 'Bed and sides'],
  ['/settings/features', 'Features'],
  ['/settings/versions', 'Software'],
  ['/settings/device', 'Pod and diagnostics'],
  ['/settings/about', 'About and license'],
  ['/settings/people', 'Bed and sides'],
  ['/settings/automation', 'Bed and sides'],
  ['/settings/sleep-data', 'Features'],
  ['/status', 'System status'],
  ['/data/logs', 'Logs'],
])('resolves %s to its settings destination', async (route, heading) => {
  renderApp(route);
  expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeVisible();
});

function CurrentRoute() {
  const location = useLocation();
  return <output aria-label="Current route">{ location.pathname + location.search }</output>;
}

it.each([
  ['/data', '/sleep'], ['/data/sleep', '/sleep'],
  ['/data/vitals', '/sleep?metric=heart_rate'],
  ['/left', '/'], ['/right', '/'],
])('preserves the legacy redirect from %s', async (route, destination) => {
  renderWithProviders(<><AppRoutes/><CurrentRoute/></>, { initialRoute: route });
  await waitFor(() => expect(screen.getByLabelText('Current route').textContent).toBe(destination), { timeout: 15000 });
});


it('gives an unknown route the shared full-size page title', async () => {
  renderApp('/missing-page');
  const heading = await screen.findByRole('heading', { level: 1, name: 'Page not found' });
  expect(heading).toHaveStyle({ fontSize: '1.75rem', fontWeight: 600 });
  expect(screen.getByRole('link', { name: 'Go to Bed' })).toHaveAttribute('href', '/');
});
