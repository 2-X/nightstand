import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import PrimeButton from './PrimeButton';

function swallowRejection(event: PromiseRejectionEvent) {
  event.preventDefault();
}

describe('PrimeButton failures', () => {
  beforeEach(() => {
    window.addEventListener('unhandledrejection', swallowRejection);
    useAppStore.setState({ isUpdating: false });
  });
  afterEach(() => window.removeEventListener('unhandledrejection', swallowRejection));

  it('shows the server message and clears it on the next success', async () => {
    server.use(http.post('*/deviceStatus', () => HttpResponse.json(
      { error: { message: 'Pod hardware is not connected. Try again in a moment.' } },
      { status: 503 },
    )));
    const { user } = renderWithProviders(<PrimeButton refetch={ () => Promise.resolve() }/>);
    await user.click(await screen.findByRole('button', { name: 'Prime now' }));
    expect(await screen.findByText('Pod hardware is not connected. Try again in a moment.')).toBeInTheDocument();
    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });

    server.use(http.post('*/deviceStatus', () => new HttpResponse(null, { status: 204 })));
    await user.click(screen.getByRole('button', { name: 'Prime now' }));
    await waitFor(() => expect(screen.queryByText(/Pod hardware is not connected/)).not.toBeInTheDocument(), { timeout: 5000 });
    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });
  });

  it('falls back to a plain message', async () => {
    server.use(http.post('*/deviceStatus', () => new HttpResponse(null, { status: 500 })));
    const { user } = renderWithProviders(<PrimeButton refetch={ () => Promise.resolve() }/>);
    await user.click(await screen.findByRole('button', { name: 'Prime now' }));
    expect(await screen.findByText('Could not reach the Pod. Try again.')).toBeInTheDocument();
    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });
  });
});
