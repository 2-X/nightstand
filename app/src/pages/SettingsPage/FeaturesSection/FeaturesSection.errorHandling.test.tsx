import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import FeaturesSection from './FeaturesSection';

// The injected 500 is handled by the app, but the rejected request can surface
// as a transient unhandled rejection under CI timing; swallow it so it does not
// fail the run.
function swallowRejection(event: PromiseRejectionEvent) {
  event.preventDefault();
}

describe('FeaturesSection error handling', () => {
  beforeEach(() => window.addEventListener('unhandledrejection', swallowRejection));
  afterEach(() => window.removeEventListener('unhandledrejection', swallowRejection));

  it('leaves the switch checked when the save POST fails', async () => {
    let postCount = 0;
    server.use(
      http.post('*/api/settings', () => {
        postCount++;
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const { user } = renderWithProviders(<FeaturesSection />);

    const toggle = await screen.findByRole('switch', { name: 'One-time alarm' }) as HTMLInputElement;
    // Default mock oneOffAlarms is true.
    expect(toggle.checked).toBe(true);

    await user.click(toggle);

    await waitFor(() => expect(postCount).toBeGreaterThan(0));

    // The switch is bound directly to server-confirmed settings (no
    // optimistic flip), so a failed save should leave it exactly as it was.
    await waitFor(() => expect(toggle.checked).toBe(true));
  });
});

it('shows the backend repair hint when a biometrics change fails', async () => {
  const message = 'Cannot run free-sleep-stream.service: its service or sudo permission is missing. '
    + 'A successful update repairs these rules and services.';
  server.use(http.post('*/api/services', () => HttpResponse.json({ error: message }, { status: 500 })));
  const { user } = renderWithProviders(<FeaturesSection />);
  const toggle = await screen.findByRole('switch', { name: 'Biometrics' });
  await user.click(toggle);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(toggle).toBeChecked();
});

it('keeps client validation failures generic', async () => {
  server.use(http.post('*/api/services', () => HttpResponse.json({ error: 'Internal validation detail' }, { status: 400 })));
  const { user } = renderWithProviders(<FeaturesSection />);
  await user.click(await screen.findByRole('switch', { name: 'Biometrics' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this change. Try again.');
});
