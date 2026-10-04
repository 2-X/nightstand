import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { getSettings } from '../../mocks/mockData';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import LastNightChip from './LastNightChip';
import { useLastNight } from './useLastNight';

function Chip() {
  return <LastNightChip lastNight={ useLastNight() } />;
}

const record = (id: number, enteredBedAt: string, leftBedAt: string, seconds: number) => ({
  id, side: 'left', entered_bed_at: enteredBedAt, left_bed_at: leftBedAt, sleep_period_seconds: seconds,
  times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
});

it('shows the longest record of the newest wake date, as the Sleep page does', async () => {
  server.use(
    http.get('*/metrics/sleep', () => HttpResponse.json([
      record(1, '2026-09-22T22:00:00-07:00', '2026-09-23T06:30:00-07:00', 30_000),
      record(2, '2026-09-23T08:10:00-07:00', '2026-09-23T12:00:00-07:00', 13_000),
    ])),
  );

  renderWithProviders(<Chip />);

  expect(await screen.findByText('Last night: 8h 20m in bed')).toBeInTheDocument();
});

it('ignores a stale row appended after the newest night', async () => {
  server.use(
    http.get('*/metrics/sleep', () => HttpResponse.json([
      record(2, '2026-09-23T22:00:00-07:00', '2026-09-24T06:30:00-07:00', 30_000),
      record(1, '2026-09-10T22:00:00-07:00', '2026-09-11T06:30:00-07:00', 7_200),
    ])),
  );

  renderWithProviders(<Chip />);

  expect(await screen.findByText('Last night: 8h 20m in bed')).toBeInTheDocument();
});

it('waits for the Pod time zone instead of guessing UTC, so the right night is shown', async () => {
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
  );

  renderWithProviders(<Chip />);

  expect(await screen.findByText('Last night: 8h 20m in bed')).toBeInTheDocument();
});

it('groups nights in UTC, as the Sleep page does, when the Pod time zone is unset', async () => {
  server.use(
    http.get('*/settings', () => HttpResponse.json({ ...getSettings(), timeZone: null })),
    http.get('*/metrics/sleep', () => HttpResponse.json([
      record(1, '2026-09-22T22:00:00-07:00', '2026-09-23T06:30:00-07:00', 30_000),
      // Wakes on the 24th in UTC.
      record(2, '2026-09-23T17:00:00-07:00', '2026-09-23T18:00:00-07:00', 3_600),
    ])),
  );

  renderWithProviders(<Chip />);

  expect(await screen.findByText('Last night: 1h in bed')).toBeInTheDocument();
});

it('shows nothing for a night with no time in bed', async () => {
  server.use(
    http.get('*/metrics/sleep', () => HttpResponse.json([record(1, '2026-09-23T06:30:00-07:00', '2026-09-23T06:30:00-07:00', 0)])),
  );
  renderWithProviders(<Chip />);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(screen.queryByText(/^Last night/)).not.toBeInTheDocument();
});
