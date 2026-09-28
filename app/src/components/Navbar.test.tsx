import { beforeEach, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { renderWithProviders } from '@test/renderWithProviders';
import Navbar from './Navbar';
import { useUpdateAttentionStore } from '@state/updateAttentionStore';
import { http, HttpResponse } from 'msw';
import { server } from '@test/setup';
import { getServerStatus } from '../mocks/mockData';

beforeEach(() => useUpdateAttentionStore.getState().setUpdateAttention(false));

function HistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={ () => navigate('/settings/versions') }>Open software</button>
      <button onClick={ () => navigate(-1) }>Back</button>
      <Navbar />
    </>
  );
}

it('four named destinations track nested routes and browser Back', async () => {
  const { user } = renderWithProviders(<HistoryControls />, { initialRoute: '/sleep' });
  const navigation = screen.getByRole('navigation', { name: 'Primary mobile' });
  const links = within(navigation).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual(['Bed', 'Schedule', 'Sleep', 'Settings']);
  expect(within(navigation).getByRole('link', { name: 'Sleep' })).toHaveAttribute('aria-current', 'page');
  await user.click(screen.getByRole('button', { name: 'Open software' }));
  expect(within(navigation).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(within(navigation).getByRole('link', { name: 'Sleep' })).toHaveAttribute('aria-current', 'page');
});

it('names update attention and preserves the service alert when it clears', async () => {
  const data = getServerStatus();
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({ ...data,
    franken: { ...data.franken, status: 'failed' },
  })));
  useUpdateAttentionStore.setState({ updateAttention: true });
  renderWithProviders(<Navbar/>);
  expect((await screen.findAllByRole('link', { name: 'Settings, update needs attention, system needs attention' })).length).toBeGreaterThan(0);
  act(() => useUpdateAttentionStore.getState().setUpdateAttention(false));
  expect((await screen.findAllByRole('link', { name: 'Settings, system needs attention' })).length).toBeGreaterThan(0);
});

it('clears update attention when a late completion arrives on another page', async () => {
  useUpdateAttentionStore.getState().setUpdateAttention(true, 'timed_out', '2.1.5');
  const { queryClient } = renderWithProviders(<Navbar/>, { initialRoute: '/sleep' });
  expect((await screen.findAllByRole('link', { name: /Settings, update needs attention/ })).length).toBeGreaterThan(0);
  act(() => queryClient.setQueryData(['useDeviceStatus'], { freeSleep: { version: '2.1.6' } }));
  await waitFor(() => expect(useUpdateAttentionStore.getState().updateAttention).toBe(false));
  expect(screen.queryByRole('link', { name: /update needs attention/ })).not.toBeInTheDocument();
});
