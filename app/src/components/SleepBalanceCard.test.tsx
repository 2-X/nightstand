import { describe, it, expect } from 'vitest';
import moment from 'moment-timezone';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import type { SleepRecord } from '@api/sleepSchema';
import SleepBalanceCard from './SleepBalanceCard';
const timeZone = 'America/Los_Angeles';
const weekStart = moment.tz('2026-09-21', timeZone);
const base: SleepRecord = {
  id: 1, side: 'left', entered_bed_at: '2026-09-22T06:00:00Z', left_bed_at: '2026-09-22T14:00:00Z',
  sleep_period_seconds: 28800, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
};
describe('Sleep balance coverage', () => {
  it('compares one recorded night only and excludes fetched adjacent-week records', () => {
    renderWithProviders(<SleepBalanceCard
      records={ [base, { ...base, id: 2, left_bed_at: '2026-09-20T14:00:00Z' }] }
      weekStart={ weekStart }
      timeZone={ timeZone }/>);
    expect(screen.getByText('1 of 7 nights recorded')).toBeInTheDocument();
    expect(screen.getByText('8h 0m average')).toBeInTheDocument();
    expect(screen.queryByText(/-48h/)).not.toBeInTheDocument();
  });
  it('keeps an observed zero duration distinct from no recording', () => {
    renderWithProviders(<SleepBalanceCard records={ [{ ...base, sleep_period_seconds: 0 }] } weekStart={ weekStart } timeZone={ timeZone }/>);
    expect(screen.getByText('1 of 7 nights recorded')).toBeInTheDocument();
    expect(screen.getByText('0h 0m average')).toBeInTheDocument();
    expect(screen.getByText(/8h 0m below/)).toBeInTheDocument();
  });
  it('counts multiple sessions on the same local day as one recorded night', () => {
    renderWithProviders(<SleepBalanceCard
      records={ [base, {
        ...base, id: 2, entered_bed_at: '2026-09-22T21:00:00Z', left_bed_at: '2026-09-22T22:00:00Z', sleep_period_seconds: 3600,
      }] }
      weekStart={ weekStart }
      timeZone={ timeZone }/>);
    expect(screen.getByText('1 of 7 nights recorded')).toBeInTheDocument();
    expect(screen.getByText('9h 0m average')).toBeInTheDocument();
  });
});

it('reports the average deficit per recorded night', () => {
  renderWithProviders(<SleepBalanceCard
    records={ [
      { ...base, sleep_period_seconds: 6 * 3600 },
      { ...base, id: 2, left_bed_at: '2026-09-23T14:00:00Z', sleep_period_seconds: 7 * 3600 },
    ] }
    weekStart={ weekStart }
    timeZone={ timeZone }/>);
  expect(screen.getByText(/1h 30m below an 8-hour reference per recorded night/)).toBeInTheDocument();
});
