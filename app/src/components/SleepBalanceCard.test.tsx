import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import moment from 'moment-timezone';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import type { SleepRecord } from '@api/sleepSchema';
import SleepBalanceCard from './SleepBalanceCard';
const timeZone = 'America/Los_Angeles';
const weekStart = moment.tz('2026-09-21', timeZone);
const base: SleepRecord = {
  id: 1, side: 'left', entered_bed_at: '2026-09-22T06:00:00Z', left_bed_at: '2026-09-22T14:00:00Z',
  sleep_period_seconds: 28800, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
};
const stages = (asleep = false, light = 25200) => ({
  active: true, epochs: asleep ? [{ startUnix: 1, endUnix: light + 1, stage: 'light' }] : [],
  totals: { light, rem: 0, deep: 0, awake: 28800 - light }, percentages: { light: 81, rem: 0, deep: 0, awake: 19 }, totalSeconds: 28800,
});
beforeEach(() => server.use(http.get('*/metrics/sleep-stages', () => HttpResponse.json(stages()))));
describe('Sleep balance coverage', () => {
  it('compares one recorded night only and excludes fetched adjacent-week records', async () => {
    renderWithProviders(<SleepBalanceCard
      records={ [base, { ...base, id: 2, left_bed_at: '2026-09-20T14:00:00Z' }] }
      weekStart={ weekStart }
      timeZone={ timeZone }/>);
    expect(screen.getByText('1 of 7 nights recorded')).toBeInTheDocument();
    expect(await screen.findByText('8h in bed on average')).toBeInTheDocument();
  });
  it('keeps an observed zero duration distinct from no recording', async () => {
    renderWithProviders(<SleepBalanceCard records={ [{ ...base, sleep_period_seconds: 0 }] } weekStart={ weekStart } timeZone={ timeZone }/>);
    expect(screen.getByText('1 of 7 nights recorded')).toBeInTheDocument();
    expect(await screen.findByText('0h in bed on average')).toBeInTheDocument();
    expect(screen.getByText(/Under the 7h to 9h range for time in bed/)).toBeInTheDocument();
  });
  it('uses the same longest session as Night when a day has multiple sessions', async () => {
    renderWithProviders(<SleepBalanceCard
      records={ [base, {
        ...base, id: 2, entered_bed_at: '2026-09-22T21:00:00Z', left_bed_at: '2026-09-22T22:00:00Z', sleep_period_seconds: 3600,
      }] }
      weekStart={ weekStart }
      timeZone={ timeZone }/>);
    expect(screen.getByText('1 of 7 nights recorded')).toBeInTheDocument();
    expect(await screen.findByText('8h in bed on average')).toBeInTheDocument();
  });
  it('uses asleep duration when stages exist', async () => {
    server.use(http.get('*/metrics/sleep-stages', () => HttpResponse.json(stages(true))));
    renderWithProviders(<SleepBalanceCard records={ [base] } weekStart={ weekStart } timeZone={ timeZone }/>);
    expect(await screen.findByText('7h asleep on average (estimate)')).toBeInTheDocument();
    expect(screen.getByText('Within the 7h to 9h range.')).toBeInTheDocument();
    expect(screen.queryByText('8h in bed on average')).not.toBeInTheDocument();
  });
  it('says under the range, without calling it the reader\'s own, below seven hours asleep', async () => {
    server.use(http.get('*/metrics/sleep-stages', () => HttpResponse.json(stages(true, 23400))));
    renderWithProviders(<SleepBalanceCard records={ [base] } weekStart={ weekStart } timeZone={ timeZone }/>);
    expect(await screen.findByText('6h 30m asleep on average (estimate)')).toBeInTheDocument();
    expect(screen.getByText('Under the 7h to 9h range.')).toBeInTheDocument();
  });
  it('labels mixed coverage with separate averages instead of adding bed time to asleep time', async () => {
    server.use(http.get('*/metrics/sleep-stages', ({ request }) => HttpResponse.json(stages(
      new URL(request.url).searchParams.get('startTime') === base.entered_bed_at,
    ))));
    renderWithProviders(<SleepBalanceCard
      records={ [base, {
        ...base, id: 2, entered_bed_at: '2026-09-23T06:00:00Z', left_bed_at: '2026-09-23T14:00:00Z',
      }] }
      weekStart={ weekStart }
      timeZone={ timeZone }/>);
    expect(await screen.findByText('7h asleep on average (estimate)')).toBeInTheDocument();
    expect(await screen.findByText('8h in bed on average')).toBeInTheDocument();
    expect(screen.getByText('1 night with an estimate of time asleep')).toBeInTheDocument();
    expect(screen.getByText('1 night with time in bed only')).toBeInTheDocument();
  });
});


afterEach(() => vi.restoreAllMocks());
it('does not call upcoming nights incomplete coverage', async () => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-21T20:00:00Z'));
  renderWithProviders(<SleepBalanceCard
    records={ [{ ...base, left_bed_at: '2026-09-21T14:00:00Z' }] }
    weekStart={ weekStart }
    timeZone={ timeZone }/>);
  expect(await screen.findByText('8h in bed on average')).toBeInTheDocument();
  expect(screen.queryByText(/Incomplete coverage/)).not.toBeInTheDocument();
  expect(screen.getByText('All nights so far recorded. Upcoming nights are not counted.')).toBeInTheDocument();
});
