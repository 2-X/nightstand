import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import OneOffAlarmSection from './OneOffAlarmSection';

// This test deliberately makes the one-off alarm save reject. The app
// catches it, but the rejected request can be reported as a transient
// unhandled rejection depending on timing; swallow that expected rejection
// so it does not fail the run. Pattern copied from
// ControlTempPage.tempRevertOnError.test.tsx.
function swallowRejection(event: PromiseRejectionEvent) {
  event.preventDefault();
}

// Regression: when the one-off alarm save fails, the local `saving` state
// must clear (finally runs regardless of the catch) so the button is usable
// again rather than stuck showing a spinner forever.
describe('OneOffAlarmSection save error recovery', () => {
  beforeEach(() => window.addEventListener('unhandledrejection', swallowRejection));
  afterEach(() => window.removeEventListener('unhandledrejection', swallowRejection));

  it('clears the saving state and re-enables the button when the save POST fails', async () => {
    server.use(
      http.post('*/settings', () => new HttpResponse(null, { status: 500 })),
    );

    const { user } = renderWithProviders(<OneOffAlarmSection />, { initialRoute: '/schedules' });

    const save = await screen.findByRole('button', { name: 'Save one-off alarm' }) as HTMLButtonElement;
    await user.click(save);

    // After the failed save settles, the button must return to its normal,
    // enabled state - not remain stuck in the saving spinner.
    const savedAgain = await screen.findByRole('button', { name: 'Save one-off alarm' }) as HTMLButtonElement;
    await waitFor(() => expect(savedAgain.disabled).toBe(false), { timeout: 3000 });
  });
});
