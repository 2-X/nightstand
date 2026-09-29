import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import { renderApp, renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getServerStatus } from '../../mocks/mockData';
import StatusPage from './StatusPage';

describe('StatusPage', () => {
  // The visible page title is "System", not "Status".
  it('renders the system status page', async () => {
    renderWithProviders(<StatusPage />, { initialRoute: '/status' });
    expect(await screen.findByText('System status')).toBeInTheDocument();
  });

  it('flags a low water tank as needing attention', async () => {
    server.use(
      http.get('/api/serverStatus', () => HttpResponse.json({
        ...getServerStatus(),
        waterTank: {
          name: 'Water tank',
          status: 'failed',
          description: 'Water level in the tank',
          message: '',
          timestamp: '2026-09-26T03:10:00Z',
        },
      })),
    );
    renderWithProviders(<StatusPage />, { initialRoute: '/status' });

    expect(await screen.findByText('The tank is low or empty. Refill it.')).toBeInTheDocument();
    expect(screen.getAllByText(/Water tank/).length).toBeGreaterThan(0);
  });
});

it('shows request failures with retry instead of an empty system page', async () => {
  server.use(http.get('/api/serverStatus', () => new HttpResponse(null, { status: 503 })));
  renderWithProviders(<StatusPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the Pod");
  expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
});
it('keeps healthy schedule details collapsed until requested', async () => {
  const { user } = renderWithProviders(<StatusPage />);
  const group = await screen.findByRole('button', { name: /Schedules.*healthy/ });
  expect(group).toHaveAttribute('aria-expanded', 'false');
  await user.click(group);
  expect(await screen.findByText('Your alarms are loaded.')).toBeVisible();
});

it('puts a failed sensor before ongoing work within its group', async () => {
  const data = Object.assign({ analyzeSleepLeft: getServerStatus().analyzeSleepLeft }, getServerStatus());
  data.analyzeSleepLeft = { name: 'Running analysis', status: 'started', description: '', message: '' };
  data.waterTank = { name: 'Water issue', status: 'failed', description: '', message: '' };
  server.use(http.get('/api/serverStatus', () => HttpResponse.json(data)));
  renderWithProviders(<StatusPage />);
  const failure = await screen.findByText('Water issue');
  const running = screen.getByText('Running analysis');
  expect(failure.compareDocumentPosition(running) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('does not count uninstalled optional biometrics as an error', async () => {
  const data = getServerStatus();
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({ ...data,
    biometricsInstallation: { ...data.biometricsInstallation, status: 'not_started' },
  })));
  renderWithProviders(<StatusPage/>);
  expect(await screen.findByText('Everything is running')).toBeVisible();
  expect(screen.queryByText(/Needs attention/)).not.toBeInTheDocument();
});
it('lets the user collapse a group containing ongoing work', async () => {
  const data = getServerStatus();
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({ ...data,
    analyzeSleepLeft: { ...data.analyzeSleepLeft, status: 'waiting_for_data' },
  })));
  const { user } = renderWithProviders(<StatusPage/>);
  const group = await screen.findByRole('button', { name: /Sleep tracking/ });
  expect(group).toHaveAttribute('aria-expanded', 'false');
  await user.click(group);
  expect(group).toHaveAttribute('aria-expanded', 'true');
  await user.click(group);
  expect(group).toHaveAttribute('aria-expanded', 'false');
});

it('shows a stale check as unreachable instead of healthy', async () => {
  const { queryClient } = renderWithProviders(<StatusPage/>);
  await screen.findByText('Everything is running');
  act(() => queryClient.setQueryData(['useServerStatus'], queryClient.getQueryData(['useServerStatus']), { updatedAt: Date.now() - 70_000 }));
  expect(await screen.findByText(/Showing the last check/)).toBeVisible();
  expect(screen.queryByText('Everything is running')).not.toBeInTheDocument();
});

it('labels optional installation status without counting it as attention', async () => {
  const data = getServerStatus();
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({ ...data,
    biometricsInstallation: { ...data.biometricsInstallation, status: 'not_started' },
  })));
  const { user } = renderWithProviders(<StatusPage/>);
  await user.click(await screen.findByRole('button', { name: /Sleep tracking/ }));
  expect(await screen.findByText('Not installed (optional)')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Set up in Features' })).toHaveAttribute('href', '/settings/features');
  expect(screen.queryByText(/Needs attention/)).not.toBeInTheDocument();
});

it('does not report an empty status response as healthy', async () => {
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({})));
  renderWithProviders(<StatusPage/>);
  expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the Pod");
  expect(screen.queryByText('Everything is running')).not.toBeInTheDocument();
});

it('opens a group when a new failure arrives after it was collapsed', async () => {
  const { user, queryClient } = renderWithProviders(<StatusPage/>);
  const group = await screen.findByRole('button', { name: /Schedules.*healthy/ });
  await user.click(group);
  await user.click(group);
  expect(group).toHaveAttribute('aria-expanded', 'false');
  const data = getServerStatus();
  act(() => queryClient.setQueryData(['useServerStatus'], {
    status: { ...data, alarmSchedule: { ...data.alarmSchedule, status: 'failed' } },
  }));
  await waitFor(() => expect(group).toHaveAttribute('aria-expanded', 'true'));
});

it.each(['franken', 'jobs', 'systemDate'] as const)('does not claim readiness before %s starts', async (key) => {
  const data = getServerStatus();
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({ ...data,
    frankenMonitor: { ...data.frankenMonitor, status: 'healthy' },
    [key]: { ...data[key], status: 'not_started' },
  })));
  renderWithProviders(<StatusPage/>);
  expect(await screen.findByText('Waiting for core services')).toBeVisible();
  expect(screen.queryByText('Everything is running')).not.toBeInTheDocument();
  expect(screen.queryByText(/Needs attention/)).not.toBeInTheDocument();
});

it('requires every core check before announcing readiness', async () => {
  const data = getServerStatus();
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({
    express: data.express, alarmSchedule: data.alarmSchedule,
  })));
  renderWithProviders(<StatusPage/>);
  expect(await screen.findByText('Waiting for core services')).toBeVisible();
  expect(screen.queryByText('Everything is running')).not.toBeInTheDocument();
});

it('announces readiness with healthy core checks and optional biometrics absent', async () => {
  const data = getServerStatus();
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({ ...data,
    frankenMonitor: { ...data.frankenMonitor, status: 'healthy' },
    biometricsInstallation: { ...data.biometricsInstallation, status: 'not_started' },
  })));
  renderWithProviders(<StatusPage/>);
  expect(await screen.findByText('Everything is running')).toBeVisible();
});

it('names a starting core service and includes it in the group summary', async () => {
  const data = getServerStatus();
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({ ...data,
    express: { ...data.express, timestamp: new Date().toISOString() },
    frankenMonitor: { ...data.frankenMonitor, status: 'not_started' },
  })));
  renderWithProviders(<StatusPage/>);
  expect(await screen.findByText('Waiting for Franken monitor.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Core services · 6 healthy, 1 starting' })).toBeVisible();
});

it('warns about a core service that has not started after the server grace period', async () => {
  const data = getServerStatus();
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({ ...data,
    express: { ...data.express, timestamp: new Date(Date.now() - 180_000).toISOString() },
    frankenMonitor: { ...data.frankenMonitor, status: 'not_started' },
  }, { headers: { Date: new Date().toUTCString() } })));
  renderWithProviders(<StatusPage/>);
  expect(await screen.findByText('Franken monitor has not started. Check the service below or open Logs.')).toBeVisible();
  expect(screen.getByText('Some services need attention')).toBeVisible();
  expect(screen.getByRole('button', { name: /Core services/ })).toHaveAttribute('aria-expanded', 'true');
});

it('shows the ready state with the demo core checks', async () => {
  renderWithProviders(<StatusPage/>);
  expect(await screen.findByText('Everything is running')).toBeVisible();
});


it.each([-3_600_000, 3_600_000])('uses the Pod clock with a %i ms offset from the phone', async offset => {
  const data = getServerStatus();
  const podNow = Date.now() + offset;
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({ ...data,
    express: { ...data.express, timestamp: new Date(podNow - 30_000).toISOString() },
    frankenMonitor: { ...data.frankenMonitor, status: 'not_started' },
  }, { headers: { Date: new Date(podNow).toUTCString() } })));
  renderWithProviders(<StatusPage/>);
  expect(await screen.findByText('Waiting for core services')).toBeVisible();
  expect(screen.queryByText('Some services need attention')).not.toBeInTheDocument();
});

it.each([-3_600_000, 3_600_000])('carries overdue attention through Settings and System at a %i ms Pod offset', async offset => {
  const data = getServerStatus();
  const podNow = Date.now() + offset;
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({ ...data,
    express: { ...data.express, timestamp: new Date(podNow - 180_000).toISOString() },
    frankenMonitor: { ...data.frankenMonitor, status: 'not_started' },
  }, { headers: { Date: new Date(podNow).toUTCString() } })));
  const { user } = renderApp('/settings');
  const device = await screen.findByRole('link', { name: 'Pod and diagnostics 1 items need attention' });
  expect((await screen.findAllByRole('link', { name: 'Settings, system needs attention' })).length).toBeGreaterThan(0);
  await user.click(device);
  await user.click(await screen.findByRole('link', { name: 'System status' }));
  expect(await screen.findByText('Some services need attention')).toBeVisible();
  expect(screen.getByText('Franken monitor has not started. Check the service below or open Logs.')).toBeVisible();
});

it.each([undefined, 'invalid'])('stays conservative without a usable Date header (%s) across repeated checks', async dateHeader => {
  const data = getServerStatus();
  const started = new Date(Date.now() - 3_600_000).toISOString();
  const snapshot = { ...data,
    express: { ...data.express, timestamp: started },
    frankenMonitor: { ...data.frankenMonitor, status: 'not_started' },
  };
  server.use(http.get('/api/serverStatus', () => HttpResponse.json(snapshot,
    dateHeader ? { headers: { Date: dateHeader } } : undefined)));
  const monotonic = vi.spyOn(performance, 'now').mockReturnValue(1000);
  try {
    const { user, queryClient } = renderWithProviders(<StatusPage/>);
    expect(await screen.findByText('Waiting for core services')).toBeVisible();
    monotonic.mockReturnValue(61_000);
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['useServerStatus'] }); });
    expect(screen.getByText('Waiting for core services')).toBeVisible();
    monotonic.mockReturnValue(131_000);
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Some services need attention')).toBeVisible();
  } finally {
    monotonic.mockRestore();
  }
});


it('refreshes the Pod clock even when a later status response has identical service data', async () => {
  const data = getServerStatus();
  const startedAt = Date.now() + 3_600_000;
  let podNow = startedAt + 30_000;
  const snapshot = { ...data,
    express: { ...data.express, timestamp: new Date(startedAt).toISOString() },
    frankenMonitor: { ...data.frankenMonitor, status: 'not_started' },
  };
  server.use(http.get('/api/serverStatus', () => HttpResponse.json(snapshot,
    { headers: { Date: new Date(podNow).toUTCString() } })));
  const { user } = renderWithProviders(<StatusPage/>);
  expect(await screen.findByText('Waiting for core services')).toBeVisible();
  podNow = startedAt + 180_000;
  await user.click(screen.getByRole('button', { name: 'Check again' }));
  expect(await screen.findByText('Some services need attention')).toBeVisible();
});

it('does not carry missing-header clock evidence into another query cache', async () => {
  const data = getServerStatus();
  const startedAt = new Date(Date.now() - 3_600_000).toISOString();
  const snapshot = { ...data,
    express: { ...data.express, timestamp: startedAt },
    frankenMonitor: { ...data.frankenMonitor, status: 'not_started' },
  };
  server.use(http.get('/api/serverStatus', () => HttpResponse.json(snapshot)));
  const monotonic = vi.spyOn(performance, 'now').mockReturnValue(1000);
  try {
    const first = renderWithProviders(<StatusPage/>);
    expect(await screen.findByText('Waiting for core services')).toBeVisible();
    monotonic.mockReturnValue(131_000);
    await act(async () => { await first.queryClient.invalidateQueries({ queryKey: ['useServerStatus'] }); });
    expect(await screen.findByText('Some services need attention')).toBeVisible();
    first.unmount();
    renderWithProviders(<StatusPage/>);
    expect(await screen.findByText('Waiting for core services')).toBeVisible();
    expect(screen.queryByText('Some services need attention')).not.toBeInTheDocument();
  } finally {
    monotonic.mockRestore();
  }
});
