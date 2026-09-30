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

    const toggle = await screen.findByRole('switch', { name: 'One-time alarm' });
    await user.click(toggle);

    // Default mock oneOffAlarms is true, so the first click posts false.
    expect(posted).toEqual({ features: { oneOffAlarms: false } });
  });

  it('posts presenceAutoOff when the presence auto-off toggle is switched', async () => {
    let posted: unknown;
    server.use(
      http.post('*/api/settings', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(<FeaturesSection />);

    const toggle = await screen.findByRole('switch', { name: 'Presence auto-off' });
    expect(toggle).toBeChecked();
    await user.click(toggle);

    expect(posted).toEqual({ features: { presenceAutoOff: false } });
  });

  it('posts biometricsV2 when new sleep tracking is switched on', async () => {
    let posted: unknown;
    server.use(
      http.post('*/api/settings', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(<FeaturesSection />);

    const toggle = await screen.findByRole('switch', { name: 'New sleep tracking (beta)' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Tells the two sides apart with the bed\'s capacitance sensors. Still being tested.')).toBeVisible();
    await user.click(toggle);

    expect(posted).toEqual({ features: { biometricsV2: true } });
  });
});

it.each([null, ''])('reports invalid settings instead of leaving features loading for %s', async body => {
  server.use(http.get('*/settings', () => body === null ? HttpResponse.json(null) : new HttpResponse('')));
  renderWithProviders(<FeaturesSection/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load features.');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
