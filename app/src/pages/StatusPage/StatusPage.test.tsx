import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getServerStatus } from '../../mocks/mockData';
import StatusPage from './StatusPage';

describe('StatusPage', () => {
  // The visible page title is "System", not "Status".
  it('renders the system status page', async () => {
    renderWithProviders(<StatusPage />, { initialRoute: '/status' });
    expect(await screen.findByText('System')).toBeInTheDocument();
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
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load system status');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
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
  expect(await screen.findByText(/No reported service errors/)).toBeVisible();
});
it('lets the user collapse a group containing ongoing work', async () => {
  const data = getServerStatus();
  server.use(http.get('/api/serverStatus', () => HttpResponse.json({ ...data,
    analyzeSleepLeft: { ...data.analyzeSleepLeft, status: 'waiting_for_data' },
  })));
  const { user } = renderWithProviders(<StatusPage/>);
  const group = await screen.findByRole('button', { name: /Biometrics & sensors/ });
  expect(group).toHaveAttribute('aria-expanded', 'false');
  await user.click(group);
  expect(group).toHaveAttribute('aria-expanded', 'true');
  await user.click(group);
  expect(group).toHaveAttribute('aria-expanded', 'false');
});
