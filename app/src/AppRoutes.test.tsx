import { beforeAll, describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderApp } from '@test/renderWithProviders';
import { server } from '@test/setup';

beforeAll(async () => {
  // Warm the index route's lazy chunk once, up front. On a cold CI runner its
  // transpile cost otherwise lands inside the first render's findAllByText
  // window and can push the first full-app render past the wait timeout while
  // later ones (with the chunk already cached) stay fast.
  await import('./pages/ControlTempPage/ControlTempPage');
});

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
