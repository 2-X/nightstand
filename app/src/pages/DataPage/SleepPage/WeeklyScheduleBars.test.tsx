import { describe, it, expect } from 'vitest';
import moment from 'moment-timezone';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import type { SleepRecord } from '@api/sleepSchema.ts';
import WeeklyScheduleBars from './WeeklyScheduleBars';

// The shared mock derives every sleep record from `new Date()` at module load,
// so the ASLEEP stat renders whatever the current time of day happens to be.
// That collided with the fixed "10:30pm" target label for exactly the minute
// after 23:00 local, and a single-match query then failed with "Found multiple
// elements". Serve records with times this file chooses instead, so what is
// on screen does not depend on when the suite runs.
function serveRecords(bedtime: string, wake: string) {
  const records: SleepRecord[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = moment().startOf('day').subtract(i, 'days');
    const enteredBedAt = day.clone()
      .hour(Number(bedtime.split(':')[0])).minute(Number(bedtime.split(':')[1]));
    // A bedtime at or after noon belongs to the previous evening, so that the
    // record still ENDS on `day`, which is how the component picks it.
    if (enteredBedAt.hour() >= 12) enteredBedAt.subtract(1, 'day');
    const leftBedAt = day.clone()
      .hour(Number(wake.split(':')[0])).minute(Number(wake.split(':')[1]));
    records.push({
      id: 100 + i,
      side: 'left',
      entered_bed_at: enteredBedAt.toISOString(),
      left_bed_at: leftBedAt.toISOString(),
      sleep_period_seconds: leftBedAt.diff(enteredBedAt, 'seconds'),
      times_exited_bed: 0,
      present_intervals: [[enteredBedAt.toISOString(), leftBedAt.toISOString()]],
      not_present_intervals: [],
    } as SleepRecord);
  }
  server.use(http.get('*/metrics/sleep', () => HttpResponse.json(records)));
}

describe('WeeklyScheduleBars', () => {
  it('renders the target-window labels in 12-hour form', async () => {
    serveRecords('01:15', '06:45');
    renderWithProviders(<WeeklyScheduleBars />);
    await screen.findByText('WEEKLY SCHEDULE');

    // TARGET_BEDTIME_HOUR = 22.5, TARGET_WAKE_HOUR = 8.5. These are 24h values
    // that must be shown as 12h clock labels, not floored with a literal suffix
    // (which produced "22:30pm").
    expect(await screen.findByText('10:30pm')).toBeInTheDocument();
    expect(screen.getByText('8:30am')).toBeInTheDocument();
    expect(screen.queryByText('22:30pm')).not.toBeInTheDocument();
  });

  it('still shows the target label when a night matches it exactly', async () => {
    // The collision case: the sleeper went to bed at the target time, so the
    // ASLEEP stat and the axis label read the same thing. Two matches is
    // correct here, and the target label must still be the 12h form.
    serveRecords('22:30', '06:45');
    renderWithProviders(<WeeklyScheduleBars />);
    await screen.findByText('WEEKLY SCHEDULE');

    expect(await screen.findAllByText('10:30pm')).toHaveLength(2);
    expect(screen.queryByText('22:30pm')).not.toBeInTheDocument();
  });

  it('labels each day slot with its real weekday for the trailing 7-day window', async () => {
    serveRecords('01:15', '06:45');
    renderWithProviders(<WeeklyScheduleBars />);
    await screen.findByText('WEEKLY SCHEDULE');

    // The 7 bars are "today - 6..0 days"; the labels must follow those actual
    // dates, with the final slot shown as "Today". A hardcoded Mon..Sat list
    // only lined up when today was a Sunday.
    const labels = screen
      .getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Today)$/)
      .map((node) => node.textContent);

    expect(labels).toHaveLength(7);
    expect(labels[6]).toBe('Today');
    // Expected weekday computed from the same clock the component reads, so the
    // assertion is deterministic on any day of the week.
    for (let i = 0; i < 6; i++) {
      const expected = moment().startOf('day').subtract(6 - i, 'days').format('ddd');
      expect(labels[i]).toBe(expected);
    }
  });
});
