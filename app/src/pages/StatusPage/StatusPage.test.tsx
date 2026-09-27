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
