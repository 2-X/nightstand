import { describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders, renderApp } from '@test/renderWithProviders';
import SettingsPage from './SettingsPage';

describe('SettingsPage', () => {
  it('renders the settings page', async () => {
    renderWithProviders(<SettingsPage />, { initialRoute: '/settings' });
    expect(await screen.findByRole('link', { name: /Bed and sides/ })).toBeInTheDocument();
  });

  // The Versions page is only reachable from here, so a silently dropped row
  // strands the version picker and instant rollback at a URL nobody types.
  it('navigates to the versions page from the Versions row', async () => {
    const { user } = renderApp('/settings');
    await act(() => vi.dynamicImportSettled());

    await user.click(await screen.findByRole('link', { name: /Software/ }));
    await act(() => vi.dynamicImportSettled());

    expect(await screen.findByText('Software')).toBeInTheDocument();
  });
});
