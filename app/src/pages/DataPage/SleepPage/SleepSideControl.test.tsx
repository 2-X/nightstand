import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import type { SleepRecord } from '@api/sleepSchema';
import SleepSideControl from './SleepSideControl';

const record = (side: string, hours: number): SleepRecord => ({
  id: hours, side, entered_bed_at: '2026-09-23T06:00:00-07:00',
  left_bed_at: `2026-09-23T${String(6 + hours).padStart(2, '0')}:00:00-07:00`,
  sleep_period_seconds: hours * 3600, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
});

describe('Sleep side captions', () => {
  it('ignores rows from another side when a side query returns them', async () => {
    server.use(http.get('*/metrics/sleep', ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('side') === 'left' ? [record('right', 1)] : [record('right', 1), record('left', 1)])));
    renderWithProviders(<SleepSideControl selectedDate="2026-09-23" timeZone="America/Los_Angeles"/>);
    expect(await screen.findByText('No recording')).toBeInTheDocument();
    expect(screen.getAllByText(/1h/)).toHaveLength(1);
  });
});
