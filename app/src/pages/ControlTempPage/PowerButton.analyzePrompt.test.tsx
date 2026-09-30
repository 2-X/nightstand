import { expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@test/setup';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { useAppStore } from '@state/appStore.tsx';
import PowerButton from './PowerButton';
import { useControlTempStore } from './controlTempStore';

it('records the power off for the prompt instead of rendering an action next to itself', async () => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  useControlTempStore.setState({ poweredOff: undefined });
  const { user } = renderWithProviders(<PowerButton isOn refetch={ () => Promise.resolve({ data: undefined }) }/>);

  await user.click(await screen.findByRole('button', { name: 'Turn off' }));
  await waitFor(() => expect(useControlTempStore.getState().poweredOff?.side).toBe('left'));
  await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });

  expect(screen.getAllByRole('button')).toHaveLength(1);
});

it('clears the prompt when the side is turned back on', async () => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  useControlTempStore.setState({ poweredOff: { side: 'left', at: Date.now() } });
  const { user } = renderWithProviders(<PowerButton isOn={ false } refetch={ () => Promise.resolve({ data: undefined }) }/>);

  await user.click(await screen.findByRole('button', { name: 'Turn on' }));
  await waitFor(() => expect(useControlTempStore.getState().poweredOff).toBeUndefined());
  await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });
});

it('does not offer the analysis for a power off that failed', async () => {
  server.use(http.post('*/deviceStatus', () => new HttpResponse(null, { status: 500 })));
  useAppStore.setState({ side: 'left', isUpdating: false });
  useControlTempStore.setState({ poweredOff: undefined });
  const { user } = renderWithProviders(<PowerButton isOn refetch={ () => Promise.resolve({ data: undefined }) }/>);

  await user.click(await screen.findByRole('button', { name: 'Turn off' }));
  await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 5000 });

  expect(useControlTempStore.getState().poweredOff).toBeUndefined();
});
