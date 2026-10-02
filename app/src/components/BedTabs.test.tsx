import { afterEach, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { server } from '@test/setup';
import { renderWithProviders } from '@test/renderWithProviders';
import { palette } from '@design/tokens';
import BedTabs from './BedTabs';

afterEach(() => localStorage.removeItem('baseConfigured'));

const baseStatus = (isConfigured: boolean) => ({ head: 0, feet: 0, isMoving: false, lastUpdate: new Date().toISOString(), isConfigured });

it('exposes bed destinations as links without orphan tab semantics', async () => {
  renderWithProviders(<BedTabs/>, { initialRoute: '/elevation' });
  const navigation = await screen.findByRole('navigation', { name: 'Bed controls' });
  expect(await within(navigation).findByRole('link', { name: 'Elevation' })).toHaveAttribute('aria-current', 'page');
  expect(within(navigation).getByRole('link', { name: 'Temperature' })).toHaveAttribute('href', '/');
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});


it('selects Temperature at its named route', async () => {
  renderWithProviders(<BedTabs/>, { initialRoute: '/temperature' });
  expect(await screen.findByRole('link', { name: 'Temperature' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Elevation' })).not.toHaveAttribute('aria-current');
});

it('holds the row\'s space, hidden, until the base check answers', async () => {
  server.use(http.get('/api/base-control', async () => {
    await delay(300);
    return HttpResponse.json(baseStatus(true));
  }));
  const { container } = renderWithProviders(<BedTabs/>);
  const row = container.querySelector('nav');
  expect(row).toHaveStyle({ visibility: 'hidden' });
  expect(screen.queryByRole('link', { name: 'Elevation' })).not.toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'Elevation' })).toBeVisible();
  expect(localStorage.getItem('baseConfigured')).toBe('true');
});

it('leaves no gap once a Pod reports no base, and remembers that', async () => {
  server.use(http.get('/api/base-control', () => HttpResponse.json(baseStatus(false))));
  const { container } = renderWithProviders(<BedTabs/>);
  await waitFor(() => expect(container.querySelector('nav')).not.toBeInTheDocument());
  expect(localStorage.getItem('baseConfigured')).toBe('false');
});

it('uses the last answer while the check runs', () => {
  localStorage.setItem('baseConfigured', 'false');
  server.use(http.get('/api/base-control', async () => {
    await delay(300);
    return HttpResponse.json(baseStatus(false));
  }));
  const { container } = renderWithProviders(<BedTabs/>);
  expect(container.querySelector('nav')).not.toBeInTheDocument();
});

it('shows the tabs at once when the last answer had a base', () => {
  localStorage.setItem('baseConfigured', 'true');
  server.use(http.get('/api/base-control', async () => {
    await delay(300);
    return HttpResponse.json(baseStatus(true));
  }));
  renderWithProviders(<BedTabs/>);
  expect(screen.getByRole('link', { name: 'Elevation' })).toBeVisible();
});

it('marks the open tab with the primary text and a 48 px target', () => {
  localStorage.setItem('baseConfigured', 'true');
  renderWithProviders(<BedTabs/>);
  const open = screen.getByRole('link', { name: 'Temperature' });
  expect(open).toHaveAttribute('aria-current', 'page');
  expect(open).toHaveStyle({ color: palette.text.primary, minHeight: '48px' });
  expect(screen.getByRole('link', { name: 'Elevation' })).toHaveStyle({ color: palette.text.secondary });
});

it('keeps the remembered tabs when the base check fails', async () => {
  localStorage.setItem('baseConfigured', 'true');
  server.use(http.get('/api/base-control', () => new HttpResponse(null, { status: 503 })));
  const { queryClient } = renderWithProviders(<BedTabs/>);
  await waitFor(() => expect(queryClient.getQueryState(['baseConfigured'])?.status).toBe('error'));
  expect(screen.getByRole('link', { name: 'Elevation' })).toBeVisible();
});

it('leaves the tabs out when the check fails and nothing is remembered', async () => {
  server.use(http.get('/api/base-control', () => new HttpResponse(null, { status: 503 })));
  const { container, queryClient } = renderWithProviders(<BedTabs/>);
  await waitFor(() => expect(queryClient.getQueryState(['baseConfigured'])?.status).toBe('error'));
  expect(container.querySelector('nav')).not.toBeInTheDocument();
});
