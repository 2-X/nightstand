import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import PrimeButton from './PrimeButton';

function swallowRejection(event: PromiseRejectionEvent) {
  event.preventDefault();
}

// Bug-hunt probe (round 2): PrimeButton.handleClick has no .finally(), unlike
// every sibling handler in this codebase (PowerButton, TemperatureButtons,
// LedBrightnessSlider, SettingsPage.updateSettings, FeaturesSection all reset
// isUpdating in a .finally). If the POST fails, isUpdating - a GLOBAL
// appStore flag that disables PowerButton, TemperatureButtons, the temp
// Slider, and this button itself - is expected to settle back to false.
describe('PrimeButton error handling', () => {
  beforeEach(() => window.addEventListener('unhandledrejection', swallowRejection));
  afterEach(() => window.removeEventListener('unhandledrejection', swallowRejection));

  it('clears the global isUpdating flag after a failed save', async () => {
    let postCount = 0;
    server.use(
      http.post('*/deviceStatus', () => {
        postCount++;
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const { user } = renderWithProviders(<PrimeButton refetch={ () => Promise.resolve() }/>);

    const button = await screen.findByRole('button', { name: 'Prime now' });
    await user.click(button);

    await waitFor(() => expect(postCount).toBeGreaterThan(0));

    // Expected: isUpdating settles back to false once the failed save
    // resolves, the same way every other write handler in this app does.
    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });
  });
});
