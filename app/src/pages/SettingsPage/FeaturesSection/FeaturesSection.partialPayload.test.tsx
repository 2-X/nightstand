import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getSettings, getServices } from '../../../mocks/mockData';
import FeaturesSection from './FeaturesSection';

// A degraded settings/services response (partially written lowdb during an
// update swap, a proxy error page, version skew) used to throw straight out of
// render here. The section had no local ErrorBoundary, so the throw escalated
// to the root boundary and blanked the whole app.
// Injected failures produce rejected promises inside react-query; without this
// the whole vitest run reds out on an unhandled rejection.
function swallowRejection(event: PromiseRejectionEvent) {
  event.preventDefault();
}

describe('FeaturesSection partial payload handling', () => {
  beforeEach(() => window.addEventListener('unhandledrejection', swallowRejection));
  afterEach(() => window.removeEventListener('unhandledrejection', swallowRejection));

  it('does not crash when the settings payload is missing the features object', async () => {
    const settingsWithoutFeatures: Record<string, unknown> = { ...getSettings() };
    delete settingsWithoutFeatures.features;
    server.use(
      http.get('*/api/settings', () => HttpResponse.json(settingsWithoutFeatures)),
    );

    renderWithProviders(<FeaturesSection />);

    expect(await screen.findByText('Features')).toBeInTheDocument();

    // Unknown feature state degrades to off and untouchable rather than
    // guessing a value the user might then save back.
    const toggle = await screen.findByRole('switch', { name: 'One-off alarms' }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
  });

  it('does not crash when the settings payload is an empty object', async () => {
    server.use(
      http.get('*/api/settings', () => HttpResponse.json({})),
    );

    renderWithProviders(<FeaturesSection />);

    expect(await screen.findByText('Features')).toBeInTheDocument();
  });

  it('does not crash when the services payload is missing biometrics', async () => {
    const servicesWithoutBiometrics: Record<string, unknown> = { ...getServices() };
    delete servicesWithoutBiometrics.biometrics;
    server.use(
      http.get('*/api/services', () => HttpResponse.json(servicesWithoutBiometrics)),
    );

    renderWithProviders(<FeaturesSection />);

    expect(await screen.findByText('Features')).toBeInTheDocument();

    // No biometrics service means nothing to install against, so the toggle
    // reads off and stays disabled.
    const toggle = await screen.findByRole('switch', { name: 'Biometrics' }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
  });
});
