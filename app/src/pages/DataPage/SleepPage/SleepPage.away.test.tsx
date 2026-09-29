import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import moment from 'moment-timezone';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getSettings, getServices } from '../../../mocks/mockData';
import { useAppStore } from '@state/appStore';
import type { SleepRecord } from '@api/sleepSchema';
import SleepPage from './SleepPage';

const record = (id: number, morning: string, hours: number): SleepRecord => ({
  id, side: 'left', entered_bed_at: moment.tz(`${morning} 07:00`, 'America/Los_Angeles').subtract(hours, 'hours').toISOString(),
  left_bed_at: moment.tz(`${morning} 07:00`, 'America/Los_Angeles').toISOString(),
  sleep_period_seconds: hours * 3600, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
});
let records: SleepRecord[];
let requests: URL[];
beforeEach(() => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-24T20:00:00Z'));
  moment.tz.setDefault('UTC');
  records = [record(1, '2026-09-22', 6), record(2, '2026-09-23', 8)];
  requests = [];
  const services = structuredClone(getServices());
  services.biometrics.jobs.analyzeSleepLeft.timestamp = '2026-09-23T19:00:00Z';
  services.biometrics.jobs.analyzeSleepRight.timestamp = '2026-09-23T19:00:00Z';
  useAppStore.setState({ side: 'left' });
  server.use(
    http.get('*/services', () => HttpResponse.json(services)),
    http.get('*/settings', () => HttpResponse.json({ ...getSettings(), timeZone: 'America/Los_Angeles' })),
    http.get('*/metrics/sleep', ({ request }) => {
      const url = new URL(request.url); requests.push(url);
      return HttpResponse.json(url.searchParams.get('side') === 'right' ? [] : records);
    }),
    http.get('*/metrics/sleep-stages', () => HttpResponse.json({
      active: true, epochs: [], totalSeconds: 0, totals: { awake: 0, light: 0, rem: 0, deep: 0 },
      percentages: { awake: 0, light: 0, rem: 0, deep: 0 },
    })),
  );
});
afterEach(() => { vi.restoreAllMocks(); moment.tz.setDefault(); });

it('keeps an away partner history selectable on Sleep', async () => {
  const settings = structuredClone(getSettings());
  settings.timeZone = 'America/Los_Angeles';
  settings.right.name = 'Partner';
  settings.right.awayMode = true;
  server.use(
    http.get('*/settings', () => HttpResponse.json(settings)),
    http.get('*/metrics/sleep', ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('side') === 'right'
        ? [{ ...record(7, '2026-09-22', 9), side: 'right' }] : records,
    )),
  );
  const { user } = renderWithProviders(<SleepPage/>);
  await screen.findByText('8h');
  await user.click(screen.getByRole('radio', { name: /Partner/ }));
  expect(await screen.findByText('9h')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Partner/ })).toBeChecked();
});
