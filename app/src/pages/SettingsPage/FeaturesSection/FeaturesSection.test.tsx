import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import FeaturesSection from './FeaturesSection';

describe('FeaturesSection', () => {
  it('posts the flag change when a feature toggle is switched', async () => {
    let posted: unknown;
    server.use(
      http.post('*/api/settings', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(<FeaturesSection />);

    const label = await screen.findByText('One-off alarms');
    const row = label.closest('div');
    if (!row) throw new Error('one-off alarms row not found');
    const toggle = row.querySelector('input[type="checkbox"]');
    if (!toggle) throw new Error('one-off alarms switch input not found');
    await user.click(toggle);

    // Default mock oneOffAlarms is true, so the first click posts false.
    expect(posted).toEqual({ features: { oneOffAlarms: false } });
  });
});
