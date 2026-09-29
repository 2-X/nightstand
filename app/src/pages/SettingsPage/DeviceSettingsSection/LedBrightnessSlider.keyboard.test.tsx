import { expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore';
import LedBrightnessSlider from './LedBrightnessSlider';

it.each([61, 0, 100, 70])('saves the committed keyboard brightness %i', async value => {
  useAppStore.setState({ isUpdating: false });
  let posted: unknown;
  server.use(http.post('*/deviceStatus', async ({ request }) => {
    posted = await request.json();
    return HttpResponse.json({});
  }));
  renderWithProviders(<LedBrightnessSlider/>);
  const slider = await screen.findByRole('slider');
  await waitFor(() => expect(slider).toHaveAttribute('aria-valuenow', '60'));
  fireEvent.change(slider, { target: { value: String(value) } });
  await waitFor(() => expect(posted).toMatchObject({ settings: { ledBrightness: value } }));
  expect(slider).toHaveAccessibleName('LED brightness');
  await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 2000 });
});
