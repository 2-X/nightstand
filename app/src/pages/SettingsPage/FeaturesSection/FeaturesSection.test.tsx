import { describe, it, expect } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getDeviceStatus, getSettings, mockCalibration } from '../../../mocks/mockData';
import { EXPERIMENTAL_ON_THIS_POD } from '@api/sleepTrackingValidation.ts';
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

describe('FeaturesSection experimental label', () => {
  const switchedOn = () => {
    const settings = getSettings();
    return { ...settings, features: { ...settings.features, biometricsV2: true } };
  };
  const formats = (left: string | null, right: string | null) => http.get('*/calibration', () => HttpResponse.json({
    left: { ...mockCalibration.left, capFormat: left },
    right: { ...mockCalibration.right, capFormat: right },
  }));
  const pod = (model: string) => http.get('*/deviceStatus', () => HttpResponse.json({
    ...getDeviceStatus(), coverVersion: model, hubVersion: model,
  }));

  const settled = (queryClient: QueryClient, status: 'success' | 'error' = 'success') => waitFor(() => {
    expect(queryClient.getQueryState(['useDeviceStatus'])?.status).toBe(status);
    expect(queryClient.getQueryState(['useCalibration'])?.status).toBe('success');
  });

  it('says nothing on a Pod 5 writing capSense2', async () => {
    server.use(http.get('*/api/settings', () => HttpResponse.json(switchedOn())), formats('capSense2', 'capSense2'));
    const { queryClient } = renderWithProviders(<FeaturesSection />);
    expect(await screen.findByRole('switch', { name: 'New sleep tracking (beta)' })).toBeChecked();
    await settled(queryClient);
    expect(screen.queryByText(EXPERIMENTAL_ON_THIS_POD)).not.toBeInTheDocument();
  });

  it('labels a Pod 4 as experimental', async () => {
    server.use(http.get('*/api/settings', () => HttpResponse.json(switchedOn())), pod('Pod 4'));
    renderWithProviders(<FeaturesSection />);
    expect(await screen.findByText(EXPERIMENTAL_ON_THIS_POD)).toBeVisible();
  });

  it('labels a Pod 5 writing the older format as experimental', async () => {
    server.use(http.get('*/api/settings', () => HttpResponse.json(switchedOn())), formats('capSense', null));
    renderWithProviders(<FeaturesSection />);
    expect(await screen.findByText(EXPERIMENTAL_ON_THIS_POD)).toBeVisible();
  });

  it('labels an unchecked format while the switch is off', async () => {
    server.use(pod('Pod 3'));
    renderWithProviders(<FeaturesSection />);
    expect(await screen.findByRole('switch', { name: 'New sleep tracking (beta)' })).not.toBeChecked();
    expect(await screen.findByText(EXPERIMENTAL_ON_THIS_POD)).toBeVisible();
  });

  it('says nothing on a Pod 5 while the switch is off', async () => {
    const { queryClient } = renderWithProviders(<FeaturesSection />);
    expect(await screen.findByRole('switch', { name: 'New sleep tracking (beta)' })).not.toBeChecked();
    await settled(queryClient);
    expect(screen.queryByText(EXPERIMENTAL_ON_THIS_POD)).not.toBeInTheDocument();
  });

  it('says nothing while device status is loading, even on an older format', async () => {
    server.use(
      http.get('*/deviceStatus', async () => { await delay('infinite'); return HttpResponse.json(getDeviceStatus()); }),
      formats('capSense', 'capSense'),
    );
    const { queryClient } = renderWithProviders(<FeaturesSection />);
    expect(await screen.findByRole('switch', { name: 'New sleep tracking (beta)' })).not.toBeChecked();
    await waitFor(() => expect(queryClient.getQueryState(['useCalibration'])?.status).toBe('success'));
    expect(queryClient.getQueryState(['useDeviceStatus'])?.status).toBe('pending');
    expect(screen.queryByText(EXPERIMENTAL_ON_THIS_POD)).not.toBeInTheDocument();
  });

  it('says nothing when device status fails, even on an older format', async () => {
    server.use(
      http.get('*/deviceStatus', () => new HttpResponse(null, { status: 500 })),
      formats('capSense', 'capSense'),
    );
    const { queryClient } = renderWithProviders(<FeaturesSection />);
    expect(await screen.findByRole('switch', { name: 'New sleep tracking (beta)' })).not.toBeChecked();
    await settled(queryClient, 'error');
    expect(screen.queryByText(EXPERIMENTAL_ON_THIS_POD)).not.toBeInTheDocument();
  });

  it('does not claim a change to the in-bed indicator or presence auto-off', () => {
    expect(EXPERIMENTAL_ON_THIS_POD).toBe('Experimental on this Pod: only checked on a Pod 5 so far. '
      + 'It changes the nightly sleep records, not the in-bed indicator or auto-off.');
    expect(EXPERIMENTAL_ON_THIS_POD).not.toMatch(/accura|verified|reliab/i);
  });
});

it.each([null, ''])('reports invalid settings instead of leaving features loading for %s', async body => {
  server.use(http.get('*/settings', () => body === null ? HttpResponse.json(null) : new HttpResponse('')));
  renderWithProviders(<FeaturesSection/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load features.');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
