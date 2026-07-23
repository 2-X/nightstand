import { describe, it, expect } from 'vitest';
import moment from 'moment-timezone';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import WeeklyScheduleBars from './WeeklyScheduleBars';

describe('WeeklyScheduleBars', () => {
  it('renders the target-window labels in 12-hour form', async () => {
    renderWithProviders(<WeeklyScheduleBars />);
    await screen.findByText('WEEKLY SCHEDULE');

    // TARGET_BEDTIME_HOUR = 22.5, TARGET_WAKE_HOUR = 8.5. These are 24h values
    // that must be shown as 12h clock labels, not floored with a literal suffix
    // (which produced "22:30pm").
    expect(await screen.findByText('10:30pm')).toBeInTheDocument();
    expect(screen.getByText('8:30am')).toBeInTheDocument();
    expect(screen.queryByText('22:30pm')).not.toBeInTheDocument();
  });

  it('labels each day slot with its real weekday for the trailing 7-day window', async () => {
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
