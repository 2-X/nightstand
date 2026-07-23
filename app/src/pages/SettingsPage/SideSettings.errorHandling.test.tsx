import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import SettingsPage from './SettingsPage';

// Bug-hunt probe (round 2): the away-mode Switch in SideSettings is a
// controlled component bound directly to `settings?.[side]?.awayMode` (a
// prop sourced from useSettings(), the server-confirmed react-query cache).
// It holds no local optimistic state of its own - unlike LedBrightnessSlider,
// which keeps a `settingsCopy` copy that it mutates ahead of the save. So a
// failed save has nothing to revert: the switch should simply stay at
// whatever the server last confirmed, the same shape as FeaturesSection.
describe('SideSettings error handling', () => {
  it('leaves the away-mode switch unchanged when the save POST fails', async () => {
    let postCount = 0;
    server.use(
      http.post('*/api/settings', () => {
        postCount++;
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const { user } = renderWithProviders(<SettingsPage/>, { initialRoute: '/settings' });

    // Wait for the Side settings section (rendered after settings load).
    await screen.findByText('Side settings');

    // Default mock awayMode is false for both sides. Find the away-mode
    // switches specifically (there may be several switches on this page).
    const awaySwitches = (await screen.findAllByRole('switch')).filter((el) => {
      const row = el.closest('div')?.parentElement;
      return row?.textContent?.includes('Away mode');
    });
    expect(awaySwitches.length).toBeGreaterThan(0);
    const awaySwitch = awaySwitches[0] as HTMLInputElement;
    expect(awaySwitch.checked).toBe(false);

    await user.click(awaySwitch);

    await waitFor(() => expect(postCount).toBeGreaterThan(0));

    // Bound directly to server-confirmed settings (no optimistic flip), so a
    // failed save should leave it exactly as it was.
    await waitFor(() => expect(awaySwitch.checked).toBe(false));
  });
});
