import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import ControlTempPage from './ControlTempPage';

// Regression: when a temperature write fails, the display must not keep showing
// the optimistic value as if it saved. It should revert to the real server
// value. (Bug: the catch block dropped the edit gate and logged, but never
// refetched, so a rejected change stuck on screen until the 60s poll.)
describe('ControlTempPage temperature revert on failed save', () => {
  it('reverts the displayed level when the save POST fails', async () => {
    const { user } = renderWithProviders(<ControlTempPage />, { initialRoute: '/' });

    // Demo left side target is 84F, which is level +1.
    const heading = await screen.findByRole('heading', { level: 2 });
    await waitFor(() => expect(heading).toHaveTextContent('+1'));

    // Make the next save fail.
    server.use(
      http.post('*/deviceStatus', () => new HttpResponse(null, { status: 500 })),
    );

    // Tap + once: the display updates optimistically to +2.
    const addButton = screen.getByTestId('AddIcon').closest('button') as HTMLButtonElement;
    await user.click(addButton);
    await waitFor(() => expect(heading).toHaveTextContent('+2'));

    // After the failed save settles, the display reverts to the server value +1.
    await waitFor(() => expect(heading).toHaveTextContent('+1'), { timeout: 5000 });
  });
});
