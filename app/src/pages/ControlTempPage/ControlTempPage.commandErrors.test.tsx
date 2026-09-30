import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import ControlTempPage from './ControlTempPage';
import { useControlTempStore } from './controlTempStore';

function swallowRejection(event: PromiseRejectionEvent) {
  event.preventDefault();
}

const notConnected = () => HttpResponse.json(
  { error: { message: 'Pod hardware is not connected. Try again in a moment.' } },
  { status: 503 },
);

describe('Bed control errors', () => {
  beforeEach(() => {
    window.addEventListener('unhandledrejection', swallowRejection);
    useAppStore.setState({ side: 'left', isUpdating: false });
    useControlTempStore.setState({ commandError: undefined, deviceStatus: undefined, pendingEdits: 0 });
  });
  afterEach(() => window.removeEventListener('unhandledrejection', swallowRejection));

  it('shows the server message when a power change fails and clears it on the next success', async () => {
    const { user } = renderWithProviders(<ControlTempPage />, { initialRoute: '/' });
    const button = await screen.findByRole('button', { name: /^Turn (on|off)$/ });
    server.use(http.post('*/deviceStatus', notConnected));
    await user.click(button);
    expect(await screen.findByText('Pod hardware is not connected. Try again in a moment.')).toBeInTheDocument();
    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });

    server.use(http.post('*/deviceStatus', () => new HttpResponse(null, { status: 204 })));
    await user.click(await screen.findByRole('button', { name: /^Turn (on|off)$/ }));
    await waitFor(() => expect(screen.queryByText(/Pod hardware is not connected/)).not.toBeInTheDocument());
    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });
  });

  it('falls back to a plain message when the server sends none', async () => {
    const { user } = renderWithProviders(<ControlTempPage />, { initialRoute: '/' });
    const button = await screen.findByRole('button', { name: /^Turn (on|off)$/ });
    server.use(http.post('*/deviceStatus', () => new HttpResponse(null, { status: 500 })));
    await user.click(button);
    expect(await screen.findByText('Could not reach the Pod. Try again.')).toBeInTheDocument();
    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });
  });

  it('shows the server message when a temperature change fails', async () => {
    const { user } = renderWithProviders(<ControlTempPage />, { initialRoute: '/' });
    await screen.findByRole('heading', { name: '+1' });
    server.use(http.post('*/deviceStatus', notConnected));
    await user.click(screen.getByRole('button', { name: 'Increase temperature' }));
    expect(await screen.findByText('Pod hardware is not connected. Try again in a moment.', undefined, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });
  });
});
