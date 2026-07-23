import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import moment from 'moment-timezone';
import { renderWithProviders } from '@test/renderWithProviders';
import SchedulePage from './SchedulePage';
import { useScheduleStore } from './scheduleStore';

// getAdjustedDayOfWeek reads moment(), whose zone follows the process default.
// A CI runner is UTC while a dev machine may not be, so pin moment's default
// zone here and freeze the clock to a fixed UTC instant: that makes the local
// hour the app sees identical on any runner. 2026-07-22 is a Wednesday.
describe('SchedulePage initial day selection under a controlled clock', () => {
  beforeEach(() => {
    moment.tz.setDefault('America/Los_Angeles');
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    moment.tz.setDefault();
  });

  it('before local noon selects yesterday', async () => {
    // 18:00 UTC == 11:00 in Los Angeles (before noon) -> yesterday (Tuesday).
    vi.setSystemTime(new Date('2026-07-22T18:00:00Z'));

    renderWithProviders(<SchedulePage />, { initialRoute: '/schedules' });

    // Wait for the schedules query to land (originalSchedules set); the
    // "Power on" label renders with fallback data before that.
    await waitFor(() => expect(useScheduleStore.getState().originalSchedules).toBeTruthy());
    await waitFor(() => expect(useScheduleStore.getState().selectedDay).toBe('tuesday'));

    const tabs = await screen.findAllByRole('tab');
    const selected = tabs.find(t => t.getAttribute('aria-selected') === 'true');
    expect(selected?.textContent?.toLowerCase()).toContain('tue');
  });

  it('after local noon selects today', async () => {
    // 20:00 UTC == 13:00 in Los Angeles (after noon) -> today (Wednesday).
    vi.setSystemTime(new Date('2026-07-22T20:00:00Z'));

    renderWithProviders(<SchedulePage />, { initialRoute: '/schedules' });

    await waitFor(() => expect(useScheduleStore.getState().originalSchedules).toBeTruthy());
    await waitFor(() => expect(useScheduleStore.getState().selectedDay).toBe('wednesday'));

    const tabs = await screen.findAllByRole('tab');
    const selected = tabs.find(t => t.getAttribute('aria-selected') === 'true');
    expect(selected?.textContent?.toLowerCase()).toContain('wed');
  });
});
