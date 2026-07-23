import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import FeaturesSection from './FeaturesSection';

describe('FeaturesSection error handling', () => {
  it('leaves the switch checked when the save POST fails', async () => {
    let postCount = 0;
    server.use(
      http.post('*/api/settings', () => {
        postCount++;
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const { user } = renderWithProviders(<FeaturesSection />);

    const toggle = await screen.findByRole('switch', { name: 'One-off alarms' }) as HTMLInputElement;
    // Default mock oneOffAlarms is true.
    expect(toggle.checked).toBe(true);

    await user.click(toggle);

    await waitFor(() => expect(postCount).toBeGreaterThan(0));

    // The switch is bound directly to server-confirmed settings (no
    // optimistic flip), so a failed save should leave it exactly as it was.
    await waitFor(() => expect(toggle.checked).toBe(true));
  });
});
