import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import SettingsPage from './SettingsPage';

describe('SettingsPage', () => {
  it('renders the settings page', async () => {
    renderWithProviders(<SettingsPage />, { initialRoute: '/settings' });
    expect(await screen.findByText('Side settings')).toBeInTheDocument();
  });
});
