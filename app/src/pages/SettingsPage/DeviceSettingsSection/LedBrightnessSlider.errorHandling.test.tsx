import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import LedBrightnessSlider from './LedBrightnessSlider';

function swallowRejection(event: PromiseRejectionEvent) {
  event.preventDefault();
}

// Bug-hunt probe (round 2): LedBrightnessSlider keeps its own optimistic
// `settingsCopy` local state, updated on every drag, and only re-synced from
// the server via a useEffect keyed on the useDeviceStatus() query result. Its
// handleSave (onChangeCommitted) catch block only console.errors - it never
// calls setSettingsCopy back to the server value, and it never calls
// refetch() either, so the effect that would otherwise re-sync from the
// server never re-fires. This is the same optimistic-update-not-reverted
// shape as the already-fixed temperature bug.
describe('LedBrightnessSlider error handling', () => {
  beforeEach(() => window.addEventListener('unhandledrejection', swallowRejection));
  afterEach(() => window.removeEventListener('unhandledrejection', swallowRejection));

  it('reverts the displayed brightness when the save POST fails', async () => {
    renderWithProviders(<LedBrightnessSlider/>);

    const slider = await screen.findByRole('slider');
    await waitFor(() => expect(slider).toHaveAttribute('aria-valuenow', '60'));

    server.use(
      http.post('*/deviceStatus', () => new HttpResponse(null, { status: 500 })),
    );

    slider.focus();
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await waitFor(() => expect(slider).toHaveAttribute('aria-valuenow', '61'));
    slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));

    // Expected: once the failed save settles, the displayed brightness
    // reverts to the last known server value (60).
    await waitFor(() => expect(slider).toHaveAttribute('aria-valuenow', '60'), { timeout: 5000 });

    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });
  });
});
