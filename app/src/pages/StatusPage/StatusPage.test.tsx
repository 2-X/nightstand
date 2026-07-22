import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import StatusPage from './StatusPage';

describe('StatusPage', () => {
  // The visible page title is "System", not "Status".
  it('renders the system status page', async () => {
    renderWithProviders(<StatusPage />, { initialRoute: '/status' });
    expect(await screen.findByText('System')).toBeInTheDocument();
  });
});
