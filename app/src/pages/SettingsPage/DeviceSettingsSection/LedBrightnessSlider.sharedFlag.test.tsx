import { expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore';
import LedBrightnessSlider from './LedBrightnessSlider';

it('leaves the updating flag alone when another save holds it', async () => {
  useAppStore.setState({ isUpdating: false });
  let saved = false;
  server.use(http.post('*/deviceStatus', async () => {
    saved = true;
    return HttpResponse.json({});
  }));
  renderWithProviders(<LedBrightnessSlider/>);
  const slider = await screen.findByRole('slider');
  await waitFor(() => expect(slider).toHaveAttribute('aria-valuenow', '60'));
  act(() => useAppStore.setState({ isUpdating: true }));
  fireEvent.change(slider, { target: { value: '61' } });
  await waitFor(() => expect(saved).toBe(true));
  await act(async () => { await delay(1_500); });
  expect(useAppStore.getState().isUpdating).toBe(true);
  act(() => useAppStore.setState({ isUpdating: false }));
});
