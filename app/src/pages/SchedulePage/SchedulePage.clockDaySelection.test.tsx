import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import SchedulePage from './SchedulePage';
import { useScheduleStore } from './scheduleStore';

// Default mock settings timeZone is America/Los_Angeles (UTC-7 in July).
// 2026-07-22 is a Wednesday.
describe('SchedulePage initial day selection under a controlled clock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('before local noon selects yesterday', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 11:00 AM PDT Wed July 22 2026 == 18:00 UTC.
    vi.setSystemTime(new Date('2026-07-22T18:00:00Z'));

    renderWithProviders(<SchedulePage />, { initialRoute: '/schedules' });

    // Wait for the schedules query to actually land (originalSchedules set) -
    // the "Power on" label renders with fallback data before that.
    await waitFor(() => expect(useScheduleStore.getState().originalSchedules).toBeTruthy());
    await waitFor(() => expect(useScheduleStore.getState().selectedDay).toBe('tuesday'));

    const tabs = await screen.findAllByRole('tab');
    const selected = tabs.find(t => t.getAttribute('aria-selected') === 'true');
    expect(selected?.textContent?.toLowerCase()).toContain('tue');
  });

  it('after local noon selects today', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 1:00 PM PDT Wed July 22 2026 == 20:00 UTC.
    vi.setSystemTime(new Date('2026-07-22T20:00:00Z'));

    renderWithProviders(<SchedulePage />, { initialRoute: '/schedules' });

    await waitFor(() => expect(useScheduleStore.getState().originalSchedules).toBeTruthy());
    await waitFor(() => expect(useScheduleStore.getState().selectedDay).toBe('wednesday'));

    const tabs = await screen.findAllByRole('tab');
    const selected = tabs.find(t => t.getAttribute('aria-selected') === 'true');
    expect(selected?.textContent?.toLowerCase()).toContain('wed');
  });
});
