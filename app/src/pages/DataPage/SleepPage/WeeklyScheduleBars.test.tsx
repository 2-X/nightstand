import { describe, it, expect } from 'vitest';
import moment from 'moment-timezone';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import type { SleepRecord } from '@api/sleepSchema';
import WeeklyScheduleBars from './WeeklyScheduleBars';

const timeZone = 'America/Los_Angeles';
const weekStart = moment.tz('2026-09-21', timeZone);
const records: SleepRecord[] = [{
  id: 1, side: 'left', entered_bed_at: '2026-09-22T05:30:00Z', left_bed_at: '2026-09-22T13:45:00Z',
  sleep_period_seconds: 29700, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
}];

describe('WeeklyScheduleBars', () => {
  it('uses the selected Monday-Sunday week, including empty days', () => {
    renderWithProviders(<WeeklyScheduleBars records={ records } weekStart={ weekStart } timeZone={ timeZone }/>);
    const labels = screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+$/).map(node => node.textContent);
    expect(labels).toEqual(['Mon 21', 'Tue 22', 'Wed 23', 'Thu 24', 'Fri 25', 'Sat 26', 'Sun 27']);
    expect(screen.getAllByText('No recording')).toHaveLength(6);
  });
  it('formats bedtime and wake time in the Pod timezone using a 12-hour clock', () => {
    renderWithProviders(<WeeklyScheduleBars records={ records } weekStart={ weekStart } timeZone={ timeZone }/>);
    expect(screen.getByText('10:30 PM / 6:45 AM')).toBeInTheDocument();
  });
  it('does not show a record from an adjacent fetched week', () => {
    renderWithProviders(<WeeklyScheduleBars records={ records } weekStart={ weekStart.clone().subtract(1, 'week') } timeZone={ timeZone }/>);
    expect(screen.queryByText('10:30 PM / 6:45 AM')).not.toBeInTheDocument();
    expect(screen.getAllByText('No recording')).toHaveLength(7);
  });
});
