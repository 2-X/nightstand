import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { useSettings } from '@api/settings.ts';
import { renderWithProviders } from './renderWithProviders';

// A probe that exercises the full stack: React Query inside the provider tree,
// issuing a real (MSW-intercepted) GET /api/settings, and rendering once the
// mock responds. Deterministic without depending on any specific mock value.
function SettingsProbe() {
  const { data } = useSettings();
  return <div>{ data ? 'settings-loaded' : 'settings-loading' }</div>;
}

describe('renderWithProviders', () => {
  it('mounts the provider stack and resolves a React Query request against MSW', async () => {
    renderWithProviders(<SettingsProbe />);
    expect(await screen.findByText('settings-loaded')).toBeInTheDocument();
  });
});
