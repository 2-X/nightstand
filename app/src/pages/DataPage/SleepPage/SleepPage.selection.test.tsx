import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('Sleep selection and period', () => {
  it('clears the previous side record when the new side has no recordings', async () => {
    renderWithProviders(<SleepPage />);
    await screen.findByText('8h 0m');
    act(() => useAppStore.getState().setSide('right'));
    await waitFor(() => expect(requests.some(url => url.searchParams.get('side') === 'right')).toBe(true));
    expect(await screen.findByText(/Nothing recorded|Not ready yet/)).toBeInTheDocument();
    expect(screen.queryByText('8h 0m')).not.toBeInTheDocument();
  });
  it('clears an empty day and preserves an explicit older night across refetch', async () => {
    const { user, queryClient } = renderWithProviders(<SleepPage />);
    await screen.findByText('8h 0m');
    await user.click(screen.getByRole('button', { name: /Tuesday, September 22/ }));
    expect(await screen.findByText('6h 0m')).toBeInTheDocument();
    records = [...records, record(3, '2026-09-24', 7)];
    await act(() => queryClient.invalidateQueries({ queryKey: ['useSleepRecords'] }));
    expect(screen.getByText('6h 0m')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Monday, September 21/ }));
    expect(await screen.findByText(/Nothing recorded|Not ready yet/)).toBeInTheDocument();
    expect(screen.queryByText('6h 0m')).not.toBeInTheDocument();
  });
  it('uses one Monday-Sunday Pod week and clears an empty previous week', async () => {
    const { user } = renderWithProviders(<SleepPage />);
    await screen.findByText('8h 0m');
    expect(screen.getByText('Sep 21 - Sep 27')).toBeInTheDocument();
    const strip = screen.getByRole('group', { name: 'Nights in selected week' });
    expect(within(strip).getAllByRole('button')).toHaveLength(7);
    expect(within(strip).getByRole('button', { name: /Sunday, September 27/ })).toBeDisabled();
    records = [];
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(await screen.findByText(/Nothing recorded|Not ready yet/)).toBeInTheDocument();
    expect(screen.queryByText('8h 0m')).not.toBeInTheDocument();
    expect(screen.getByText('Sep 14 - Sep 20')).toBeInTheDocument();
  });
  it('keeps the chosen date and Week view when switching sides', async () => {
    const { user } = renderWithProviders(<SleepPage />);
    await screen.findByText('8h 0m');
    await user.click(screen.getByRole('button', { name: /Tuesday, September 22/ }));
    await user.click(screen.getByRole('tab', { name: 'Week' }));
    act(() => useAppStore.getState().setSide('right'));
    await waitFor(() => expect(requests.some(url => url.searchParams.get('side') === 'right')).toBe(true));
    expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /Tuesday, September 22/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses Sunday in Los Angeles when the browser has already reached Monday', async () => {
    vi.mocked(moment.now).mockReturnValue(Date.parse('2026-09-28T06:30:00Z'));
    renderWithProviders(<SleepPage />);
    await screen.findByText('8h 0m');
    expect(screen.getByText('Sep 21 - Sep 27')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sunday, September 27/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
  });

  it('assigns a recording to its Pod-local wake date across UTC midnight', async () => {
    records = [{ ...record(1, '2026-09-23', 8), left_bed_at: '2026-09-24T06:30:00Z' }];
    renderWithProviders(<SleepPage />);
    await screen.findByText('8h 0m');
    expect(screen.getByRole('button', { name: /Wednesday, September 23/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('11:30 PM')).toBeInTheDocument();
  });

  it('shows Pod-local bedtime when the browser timezone differs', async () => {
    records = [record(2, '2026-09-23', 8)];
    renderWithProviders(<SleepPage />);
    expect(await screen.findByText('11:00 PM')).toBeInTheDocument();
    expect(screen.getByText('7:00 AM')).toBeInTheDocument();
  });
  it('keeps partial coverage separate from missing sleep and opens one metric at a time', async () => {
    records = [record(2, '2026-09-23', 8)];
    const { user } = renderWithProviders(<SleepPage />, { initialRoute: '/sleep?metric=heart_rate' });
    await screen.findByText('8h 0m');
    expect(screen.getByRole('button', { name: /Heart rate/ })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: /Breathing rate/ }));
    expect(screen.getByRole('button', { name: /Heart rate/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Breathing rate/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Sleep balance')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Week' }));
    expect(await screen.findByText('1 of 7 nights recorded')).toBeInTheDocument();
    expect(screen.getByText(/Missing nights are not counted as zero sleep/)).toBeInTheDocument();
    expect(screen.queryByText(/-48h/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Heart rate/ })).not.toBeInTheDocument();
  });
});

it('shows the latest prior-week recording below the selected pending Monday', async () => {
  vi.mocked(moment.now).mockReturnValue(Date.parse('2026-09-28T18:00:00Z'));
  records = [record(5, '2026-09-27', 7)];
  renderWithProviders(<SleepPage />);
  expect(await screen.findByText('7h 0m')).toBeInTheDocument();
  expect(screen.getByText('Sep 28 - Oct 4')).toBeInTheDocument();
});
it('uses unique accordion region ids', async () => {
  const { container } = renderWithProviders(<SleepPage />, { initialRoute: '/sleep?metric=heart_rate' });
  await screen.findByText('8h 0m');
  expect(container.querySelectorAll('#detail-heart_rate')).toHaveLength(1);
});

it('uses the same nightly average in the HRV row and expanded detail', async () => {
  server.use(
    http.get('*/metrics/vitals', () => HttpResponse.json([
      { side: 'left', timestamp: 1790143200, heart_rate: 60, hrv: 100, breathing_rate: 15 },
      { side: 'left', timestamp: 1790146800, heart_rate: 70, hrv: 74, breathing_rate: 17 },
    ])),
    http.get('*/metrics/vitals/summary', () => HttpResponse.json({ avgHeartRate: 63, avgHRV: 63, avgBreathingRate: 14 })),
  );
  const { user } = renderWithProviders(<SleepPage />);
  expect(await screen.findByRole('button', { name: 'HRV 87 ms' })).toBeInTheDocument();
  expect(screen.queryByText('SELECTED NIGHT')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'HRV 87 ms' }));
  await screen.findByText('SELECTED NIGHT');
  expect(screen.getAllByText('87 ms')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'HRV 87 ms' }));
  await waitFor(() => expect(screen.queryByText('SELECTED NIGHT')).not.toBeInTheDocument());
});

it('keeps the night summary visible when measurements are malformed', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  server.use(http.get('*/metrics/vitals', () => HttpResponse.json([null])));
  renderWithProviders(<SleepPage />);
  expect(await screen.findByText('Night measurements failed to load')).toBeInTheDocument();
  expect(screen.getByText('8h 0m')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Nights in selected week' })).toBeInTheDocument();
});


it('follows the new side latest week until the user chooses a date', async () => {
  server.use(http.get('*/metrics/sleep', ({ request }) => HttpResponse.json(
    new URL(request.url).searchParams.get('side') === 'right'
      ? [{ ...record(7, '2026-09-16', 9), side: 'right' }] : records,
  )));
  renderWithProviders(<SleepPage/>);
  await screen.findByText('8h 0m');
  act(() => useAppStore.getState().setSide('right'));
  expect(await screen.findByText('9h 0m')).toBeInTheDocument();
  expect(screen.getByText('Sep 14 - Sep 20')).toBeInTheDocument();
});

it('pins an explicitly chosen date week when changing to a side with older data', async () => {
  server.use(http.get('*/metrics/sleep', ({ request }) => HttpResponse.json(
    new URL(request.url).searchParams.get('side') === 'right'
      ? [{ ...record(7, '2026-09-16', 9), side: 'right' }] : records,
  )));
  const { user } = renderWithProviders(<SleepPage/>);
  await screen.findByText('8h 0m');
  await user.click(screen.getByRole('button', { name: /Tuesday, September 22/ }));
  act(() => useAppStore.getState().setSide('right'));
  await screen.findByText(/Nothing recorded|Not ready yet/);
  expect(screen.getByText('Sep 21 - Sep 27')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Tuesday, September 22/ })).toHaveAttribute('aria-pressed', 'true');
});


it('labels Night with the selected wake date and Week with the full date range', async () => {
  const { user } = renderWithProviders(<SleepPage/>);
  await screen.findByText('8h 0m');
  await user.click(screen.getByRole('button', { name: /Monday, September 21/ }));
  expect(screen.getByRole('heading', { name: 'Woke Mon, Sep 21' })).toBeInTheDocument();
  expect(screen.getByText('Nothing recorded')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Tuesday, September 22/ }));
  expect(screen.getByRole('heading', { name: 'Woke Tue, Sep 22' })).toBeInTheDocument();
  const tabs = screen.getByRole('tablist', { name: 'Sleep period' });
  const heading = screen.getByRole('heading', { name: 'Woke Tue, Sep 22' });
  expect(tabs.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await user.click(screen.getByRole('tab', { name: 'Week' }));
  expect(screen.getByRole('heading', { name: 'Sep 21 - Sep 27' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /^Woke/ })).not.toBeInTheDocument();
  expect(screen.getByText('In bed / out of bed, by wake date')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'Night' }));
  expect(screen.getByRole('heading', { name: 'Woke Tue, Sep 22' })).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'Week' }));
  await user.click(screen.getByRole('button', { name: 'Previous week' }));
  expect(screen.getByRole('heading', { name: 'Sep 14 - Sep 20' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /^Woke/ })).not.toBeInTheDocument();
});
