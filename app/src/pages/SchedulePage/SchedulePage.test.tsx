import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import { useScheduleStore } from './scheduleStore';
import SchedulePage from './SchedulePage';

describe('SchedulePage', () => {
  it('renders the schedule page once schedule data loads', async () => {
    renderWithProviders(<SchedulePage />, { initialRoute: '/schedules' });
    expect(await screen.findByText('Power on')).toBeInTheDocument();
  });
});

describe('SchedulePage save', () => {
  it('posts the edited schedule to the left side when Save is clicked', async () => {
    let posted: any;
    server.use(
      http.post('*/schedules', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(<SchedulePage />, { initialRoute: '/schedules' });

    // Toggling the power Enabled switch marks the schedule changed, which
    // reveals the Save button (hidden until changesPresent is true). MUI's
    // Switch input carries role="switch" (not "checkbox") in this MUI
    // version. The switch renders once (unchecked, before schedule data has
    // arrived) and again once the fetched schedule lands (mock data has
    // power.enabled true for every day); wait for the loaded, checked state
    // first so the click toggles the real loaded schedule instead of a value
    // that the data-loaded effect immediately overwrites.
    const enabled = await screen.findByRole('switch', { name: 'Enabled' }) as HTMLInputElement;
    await waitFor(() => expect(enabled.checked).toBe(true));
    await user.click(enabled);

    const save = await screen.findByRole('button', { name: 'Save' });
    await user.click(save);

    await waitFor(() => expect(posted).toBeTruthy());
    expect(Object.keys(posted)).toContain('left');
    // The left payload is keyed by day; at least one day entry is present.
    expect(Object.keys(posted.left).length).toBeGreaterThan(0);

    // handleSave holds isUpdating true through a 1s post-save delay plus a
    // refetch. useAppStore is a module singleton, so without waiting it out
    // here, the next test starts mid-save with every control still disabled
    // (pointer-events: none) from this test's leftover in-flight save.
    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 3000 });
  });
});

describe('SchedulePage discard on unmount', () => {
  it('drops unsaved edits when the page unmounts', async () => {
    const { user, unmount } = renderWithProviders(<SchedulePage />, { initialRoute: '/schedules' });

    const enabled = await screen.findByRole('switch', { name: 'Enabled' }) as HTMLInputElement;
    await waitFor(() => expect(enabled.checked).toBe(true));
    await user.click(enabled);
    // The edit is now pending: the store flags unsaved changes and Save shows.
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(useScheduleStore.getState().changesPresent).toBe(true);

    unmount();

    // The page's unmount cleanup calls reloadScheduleData, dropping the pending
    // edit. Assert the store directly, without remounting: a fresh mount would
    // reset changesPresent on its own, so only a post-unmount check actually
    // proves the cleanup ran (this fails if that cleanup effect is removed).
    expect(useScheduleStore.getState().changesPresent).toBe(false);
  });
});
