import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@test/setup';
import { renderWithProviders } from '@test/renderWithProviders';
import BaseControlPage from './BaseControlPage';

it('shows only connection guidance when no adjustable base is configured', async () => {
  server.use(http.get('/api/base-control', () => HttpResponse.json({ head: 0, feet: 0, isMoving: false,
    lastUpdate: new Date().toISOString(), isConfigured: false })));
  renderWithProviders(<BaseControlPage/>, { initialRoute: '/elevation' });
  expect(await screen.findByText(/No adjustable base found/)).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Bed controls' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Increase head angle' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Flat/ })).not.toBeInTheDocument();
});
