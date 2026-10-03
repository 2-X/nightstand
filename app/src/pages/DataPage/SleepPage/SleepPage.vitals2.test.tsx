import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import moment from 'moment-timezone';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getSettings, getServices } from '../../../mocks/mockData';
import { useAppStore } from '@state/appStore';
import type { SleepRecord } from '@api/sleepSchema';
import type { VitalsRecord } from '@api/vitals';
import SleepPage from './SleepPage';

const night: SleepRecord = {
  id: 2, side: 'left', entered_bed_at: '2026-09-23T06:00:00.000Z', left_bed_at: '2026-09-23T14:00:00.000Z',
  sleep_period_seconds: 8 * 3600, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
};
const minute = Date.parse('2026-09-23T08:00:00Z') / 1000;
const vitals: VitalsRecord[] = [
  { side: 'left', timestamp: minute, heart_rate: 58, hrv: 90, breathing_rate: 16,
    hr_quality: 0.8, rmssd: 40, sdnn: 38, hrv_coverage: 0.8, resp_rate: 15.5, resp_quality: 0.9, estimator: 2 },
  { side: 'left', timestamp: minute + 60, heart_rate: 60, hrv: 90, breathing_rate: 0,
    hr_quality: 0.7, rmssd: null, sdnn: null, hrv_coverage: 0.4, resp_rate: null, resp_quality: null, estimator: 2 },
  { side: 'left', timestamp: minute + 120, heart_rate: 62, hrv: 90, breathing_rate: 17,
    hr_quality: null, rmssd: 50, sdnn: 41, hrv_coverage: 0.7, resp_rate: 16.5, resp_quality: 0.8, estimator: 2 },
];

function serve(biometricsV2: boolean, avgBreathingRate = 15) {
  const services = structuredClone(getServices());
  services.biometrics.jobs.analyzeSleepLeft.timestamp = '2026-09-23T19:00:00Z';
  services.biometrics.jobs.analyzeSleepRight.timestamp = '2026-09-23T19:00:00Z';
  server.use(
    http.get('*/services', () => HttpResponse.json(services)),
    http.get('*/settings', () => HttpResponse.json({
      ...getSettings(), timeZone: 'America/Los_Angeles', features: { ...getSettings().features, biometricsV2 },
    })),
    http.get('*/metrics/sleep', () => HttpResponse.json([night])),
    http.get('*/metrics/sleep-stages', () => HttpResponse.json({
      active: true, epochs: [], totalSeconds: 0, totals: { awake: 0, light: 0, rem: 0, deep: 0 },
      percentages: { awake: 0, light: 0, rem: 0, deep: 0 },
    })),
    http.get('*/metrics/vitals', () => HttpResponse.json(vitals)),
    http.get('*/metrics/vitals/summary', () => HttpResponse.json({
      avgHeartRate: 61, minHeartRate: 58, maxHeartRate: 62, avgHRV: 0, avgBreathingRate,
    })),
  );
}

beforeEach(() => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-24T20:00:00Z'));
  moment.tz.setDefault('UTC');
  useAppStore.setState({ side: 'left' });
});
afterEach(() => { vi.restoreAllMocks(); moment.tz.setDefault(); });

describe('Sleep page vitals', () => {
  it('shows breathing rate from the minutes that have it and no HRV row when new sleep tracking is on', async () => {
    serve(true);
    renderWithProviders(<SleepPage/>);
    const breathing = await screen.findByRole('button', { name: /Breathing rate/ });
    expect(await within(breathing).findByText('16 breaths/min')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /HRV/ })).not.toBeInTheDocument();
  });

  it('shows heart rate only, with no HRV or breathing row, when new sleep tracking is off', async () => {
    serve(false);
    renderWithProviders(<SleepPage/>);
    const heart = await screen.findByRole('button', { name: /Average heart rate/ });
    expect(await within(heart).findByText('60 bpm')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /HRV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Breathing rate/ })).not.toBeInTheDocument();
  });

  it('opens heart rate when a saved link names HRV', async () => {
    serve(false);
    renderWithProviders(<SleepPage/>, { initialRoute: '/sleep?metric=hrv' });
    const heart = await screen.findByRole('button', { name: /Average heart rate/ });
    await waitFor(() => expect(heart).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.queryByText(/HRV/)).not.toBeInTheDocument();
  });

  it('shows the seven night breathing average, and leaves it out when the server reports none', async () => {
    serve(true, 14);
    const first = renderWithProviders(<SleepPage/>, { initialRoute: '/sleep?metric=resp_rate' });
    expect(await screen.findByText('7-night average 14 breaths/min', undefined, { timeout: 10_000 })).toBeInTheDocument();
    first.unmount();
    serve(true, 0);
    renderWithProviders(<SleepPage/>, { initialRoute: '/sleep?metric=resp_rate' });
    await screen.findByRole('button', { name: /Breathing rate.*16 breaths\/min/ }, { timeout: 10_000 });
    expect(screen.queryByText(/7-night average/)).not.toBeInTheDocument();
  });
});
