import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import LogsPage from './LogsPage';

describe('LogsPage', () => {
  it('renders the live server logs page', async () => {
    renderWithProviders(<LogsPage />, { initialRoute: '/data/logs' });
    expect(await screen.findByRole('heading', { name: 'Logs', level: 1 })).toBeInTheDocument();
  });
});
