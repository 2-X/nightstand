import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import { useScheduleStore } from './scheduleStore';
import SchedulePage from './SchedulePage';

// This test deliberately makes a schedule save reject. The app catches it,
// but the rejected request can be reported as a transient unhandled rejection
// depending on timing; swallow that expected rejection so it does not fail
// the run. Pattern copied from
// ControlTempPage.tempRevertOnError.test.tsx.
function swallowRejection(event: PromiseRejectionEvent) {
  event.preventDefault();
}

// Regression: when a schedule save fails, isUpdating must clear (finally
// runs regardless of the catch) and the pending edit must not be silently
// discarded - the Save button should still be available so the user can
// retry, since nothing told them the save failed.
describe('SchedulePage save revert on failed save', () => {
  beforeEach(() => window.addEventListener('unhandledrejection', swallowRejection));
  afterEach(() => window.removeEventListener('unhandledrejection', swallowRejection));

  it('clears isUpdating and keeps the pending edit available to retry when the save POST fails', async () => {
    server.use(
      http.post('*/schedules', () => new HttpResponse(null, { status: 500 })),
    );

    const { user } = renderWithProviders(<SchedulePage />, { initialRoute: '/schedules' });

    // Wait for the loaded, checked state before toggling (known race: the
    // switch renders unchecked first, then the fetched schedule effect sets
    // it checked; toggling before that lands gets immediately overwritten).
    const enabled = await screen.findByRole('switch', { name: 'Enabled' }) as HTMLInputElement;
    await waitFor(() => expect(enabled.checked).toBe(true));
    await user.click(enabled);

    const save = await screen.findByRole('button', { name: 'Save' });
    await user.click(save);

    // After the failed save settles (post rejects -> catch -> finally),
    // isUpdating must clear. The 1s post-save delay only runs on the success
    // path, so this should resolve quickly on failure.
    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 3000 });

    // The edit was never committed server-side (refetch never ran on the
    // failure path), so the store must still consider changes present and
    // the Save button must still be rendered - the user can retry rather
    // than believing the save silently succeeded and their edit being
    // stranded only in the local store.
    expect(useScheduleStore.getState().changesPresent).toBe(true);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
