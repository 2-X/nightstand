import { expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@test/setup';
import { renderWithProviders } from '@test/renderWithProviders';
import BaseControlPage from './BaseControlPage';

it('shows only connection guidance when no adjustable base is configured', async () => {
  server.use(http.get('/api/base-control', () => HttpResponse.json({ head: 0, feet: 0, isMoving: false,
    lastUpdate: new Date().toISOString(), isConfigured: false })));
  renderWithProviders(<BaseControlPage/>, { initialRoute: '/elevation' });
  expect(await screen.findByText(/No adjustable base found/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to Temperature' })).toHaveAttribute('href', '/');
  expect(screen.getByText(/Pair an adjustable base in Eight Sleep's app/)).toBeVisible();
  expect(screen.queryByRole('navigation', { name: 'Bed controls' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Increase head angle' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Flat/ })).not.toBeInTheDocument();
});


it('keeps the base error visible while the next poll is pending', async () => {
  server.use(http.get('/api/base-control', () => new HttpResponse(null, { status: 503 })));
  const { queryClient } = renderWithProviders(<BaseControlPage/>);
  await screen.findByText('Could not load the base position.');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  server.use(http.get('/api/base-control', async () => {
    await pending;
    return HttpResponse.json({ head: 0, feet: 0, isMoving: false, lastUpdate: '', isConfigured: false });
  }));
  let request!: Promise<void>;
  act(() => { request = queryClient.refetchQueries({ queryKey: ['baseStatus'] }); });
  await waitFor(() => expect(queryClient.isFetching({ queryKey: ['baseStatus'] })).toBe(1));
  const keptError = !!screen.queryByText('Could not load the base position.');
  const showedSpinner = !!screen.queryByRole('progressbar', { name: 'Loading base position' });
  release();
  await act(async () => { await request; });
  expect(keptError).toBe(true);
  expect(showedSpinner).toBe(false);
  await waitFor(() => expect(screen.queryByText('Could not load the base position.')).not.toBeInTheDocument());
});
