import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, renderApp } from '@test/renderWithProviders';
import SettingsPage from './SettingsPage';

describe('SettingsPage', () => {
  it('renders the settings page', async () => {
    renderWithProviders(<SettingsPage />, { initialRoute: '/settings' });
    expect(await screen.findByText('Side settings')).toBeInTheDocument();
  });

  // The Versions page is only reachable from here, so a silently dropped row
  // strands the version picker and instant rollback at a URL nobody types.
  it('navigates to the versions page from the Versions row', async () => {
    const { user } = renderApp('/settings');

    await user.click(await screen.findByText('Versions'));

    expect(await screen.findByText('Software & updates')).toBeInTheDocument();
  });
});
