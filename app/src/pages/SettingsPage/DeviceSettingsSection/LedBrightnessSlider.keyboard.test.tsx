import { expect, it } from 'vitest';
import { delay } from 'msw';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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

it('keeps the slider usable while saving so repeated arrow presses all apply', async () => {
  useAppStore.setState({ isUpdating: false });
  const posted: number[] = [];
  server.use(http.post('*/deviceStatus', async ({ request }) => {
    const body = await request.json() as { settings: { ledBrightness: number } };
    posted.push(body.settings.ledBrightness);
    await delay(150);
    return HttpResponse.json({});
  }));
  renderWithProviders(<LedBrightnessSlider/>);
  const slider = await screen.findByRole('slider');
  await waitFor(() => expect(slider).toHaveAttribute('aria-valuenow', '60'));

  fireEvent.change(slider, { target: { value: '61' } });
  expect(slider).toBeEnabled();
  fireEvent.change(slider, { target: { value: '62' } });
  fireEvent.change(slider, { target: { value: '63' } });
  await waitFor(() => expect(posted[posted.length - 1]).toBe(63));
  expect(slider).toBeEnabled();

  // A press that lands while the first save is still in flight is not dropped.
  fireEvent.change(slider, { target: { value: '64' } });
  await waitFor(() => expect(posted[posted.length - 1]).toBe(64), { timeout: 3000 });
  await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 3000 });
  expect(slider).toHaveAttribute('aria-valuenow', '64');
});

it('ignores a pushed device status while a change is pending or saving, so presses build on the new value', async () => {
  useAppStore.setState({ isUpdating: false });
  const posted: number[] = [];
  server.use(http.post('*/deviceStatus', async ({ request }) => {
    const body = await request.json() as { settings: { ledBrightness: number } };
    posted.push(body.settings.ledBrightness);
    await delay(100);
    return HttpResponse.json({});
  }));
  const { queryClient } = renderWithProviders(<LedBrightnessSlider/>);
  const slider = await screen.findByRole('slider');
  await waitFor(() => expect(slider).toHaveAttribute('aria-valuenow', '60'));
  const status = queryClient.getQueryData<any>(['useDeviceStatus']);
  let pushes = 0;
  // A new object every time, as a live push would be, still carrying the old brightness.
  const push = () => act(() => queryClient.setQueryData(['useDeviceStatus'], {
    ...status, isPriming: ++pushes % 2 === 0, settings: { ...status.settings, ledBrightness: 60 },
  }));

  fireEvent.change(slider, { target: { value: '61' } });
  push();
  expect(slider).toHaveAttribute('aria-valuenow', '61');
  fireEvent.change(slider, { target: { value: '62' } });
  await waitFor(() => expect(posted).toEqual([62]));
  push();
  expect(slider).toHaveAttribute('aria-valuenow', '62');
  fireEvent.change(slider, { target: { value: '63' } });
  push();
  expect(slider).toHaveAttribute('aria-valuenow', '63');
  await waitFor(() => expect(posted).toEqual([62, 63]), { timeout: 3000 });
});
