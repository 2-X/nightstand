import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import SettingsPage from './SettingsPage';

// Every section on the page is wrapped in its own ErrorBoundary so one bad
// response degrades that section only. FeaturesSection was the exception, and
// a throw there took the whole app down through the root boundary.
vi.mock('./FeaturesSection/FeaturesSection.tsx', () => ({
  default: () => {
    throw new Error('boom');
  },
}));

describe('SettingsPage section isolation', () => {
  it('keeps the rest of the page alive when the features section throws', async () => {
    renderWithProviders(<SettingsPage />, { initialRoute: '/settings' });

    expect(await screen.findByText('Features section failed to load')).toBeInTheDocument();
    expect(await screen.findByText('Side settings')).toBeInTheDocument();
    expect(await screen.findByText('Priming')).toBeInTheDocument();
  });
});
