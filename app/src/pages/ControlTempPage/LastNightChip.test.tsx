import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { getSettings } from '../../mocks/mockData';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import LastNightChip from './LastNightChip';

const record = (id: number, enteredBedAt: string, leftBedAt: string, seconds: number) => ({
  id, side: 'left', entered_bed_at: enteredBedAt, left_bed_at: leftBedAt, sleep_period_seconds: seconds,
  times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
});

it('scores the longest record of the newest wake date, as the Sleep page does', async () => {
  const requests: Array<{ startTime: string | null; endTime: string | null }> = [];
  server.use(
    http.get('*/metrics/sleep', () => HttpResponse.json([
      record(1, '2026-09-22T22:00:00-07:00', '2026-09-23T06:30:00-07:00', 30_000),
      record(2, '2026-09-23T08:10:00-07:00', '2026-09-23T12:00:00-07:00', 13_000),
    ])),
    http.get('*/metrics/sleep-score', ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.push({ startTime: params.get('startTime'), endTime: params.get('endTime') });
      return HttpResponse.json({ active: true, score: 81, components: {} });
    }),
  );

  renderWithProviders(<LastNightChip />);

  expect(await screen.findByText(/Last night estimate 81/)).toBeInTheDocument();
  expect(requests).toEqual([{
    startTime: '2026-09-22T22:00:00-07:00',
    endTime: '2026-09-23T06:30:00-07:00',
  }]);
});

it('ignores a stale row appended after the newest night', async () => {
  const requests: Array<string | null> = [];
  server.use(
    http.get('*/metrics/sleep', () => HttpResponse.json([
      record(2, '2026-09-23T22:00:00-07:00', '2026-09-24T06:30:00-07:00', 30_000),
      record(1, '2026-09-10T22:00:00-07:00', '2026-09-11T06:30:00-07:00', 30_000),
    ])),
    http.get('*/metrics/sleep-score', ({ request }) => {
      requests.push(new URL(request.url).searchParams.get('startTime'));
      return HttpResponse.json({ active: true, score: 77, components: {} });
    }),
  );

  renderWithProviders(<LastNightChip />);

  expect(await screen.findByText(/Last night estimate 77/)).toBeInTheDocument();
  expect(requests).toEqual(['2026-09-23T22:00:00-07:00']);
});

it('waits for the Pod time zone instead of guessing UTC, so only the right night is scored', async () => {
  const requests: Array<string | null> = [];
  server.use(
    http.get('*/settings', async () => {
      await delay(100);
      return HttpResponse.json({ ...getSettings(), timeZone: 'America/Los_Angeles' });
    }),
    http.get('*/metrics/sleep', () => HttpResponse.json([
      record(1, '2026-09-22T22:00:00-07:00', '2026-09-23T06:30:00-07:00', 30_000),
      // Wakes on the 23rd in Los Angeles but the 24th in UTC.
      record(2, '2026-09-23T17:00:00-07:00', '2026-09-23T18:00:00-07:00', 3_600),
    ])),
    http.get('*/metrics/sleep-score', ({ request }) => {
      requests.push(new URL(request.url).searchParams.get('startTime'));
      return HttpResponse.json({ active: true, score: 81, components: {} });
    }),
  );

  renderWithProviders(<LastNightChip />);

  expect(await screen.findByText(/Last night estimate 81/)).toBeInTheDocument();
  expect(requests).toEqual(['2026-09-22T22:00:00-07:00']);
});
