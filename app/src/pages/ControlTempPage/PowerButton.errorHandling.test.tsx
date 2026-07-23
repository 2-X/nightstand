import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import PowerButton from './PowerButton';

// This test deliberately makes a save reject. The catch path here never
// calls refetch(), so nothing should reject asynchronously after the initial
// postDeviceStatus call settles - but guard the same way as the other revert
// tests in case of CI timing weirdness.
function swallowRejection(event: PromiseRejectionEvent) {
  event.preventDefault();
}

// PowerButton's on/off label is driven by the `isOn` prop, which the caller
// (ControlTempPage) derives straight from the server's useDeviceStatus()
// query - not from the local controlTempStore that PowerButton also writes
// to. So there is no optimistic flip of the visible label to begin with: a
// failed save should leave the label exactly as it was, the whole time.
describe('PowerButton error handling', () => {
  beforeEach(() => window.addEventListener('unhandledrejection', swallowRejection));
  afterEach(() => window.removeEventListener('unhandledrejection', swallowRejection));

  it('leaves the label unchanged when the save POST fails', async () => {
    server.use(
      http.post('*/deviceStatus', () => new HttpResponse(null, { status: 500 })),
    );

    const { user } = renderWithProviders(<PowerButton isOn={ true } refetch={ () => Promise.resolve({ data: undefined }) }/>);

    const button = await screen.findByRole('button', { name: 'Turn off' });
    await user.click(button);

    // Never flips to "Turn on" at any point, including while the request is
    // in flight and disabled.
    expect(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();

    await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });

    // Still correct after the failed save settles.
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  });
});
