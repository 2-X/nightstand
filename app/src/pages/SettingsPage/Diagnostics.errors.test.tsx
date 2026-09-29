import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import StorageIndicator from './StorageIndicator';
import MemoryIndicator from './MemoryIndicator';
import { getDeviceStatus, getMemoryInfo, getStorageInfo } from '../../mocks/mockData';
import DeviceInfo from './DeviceSettingsSection/DeviceInfo';

it.each([
  {
    route: 'storage', Component: StorageIndicator, message: 'Could not load storage usage.',
    data: getStorageInfo, loaded: 'Storage',
  },
  {
    route: 'memory', Component: MemoryIndicator, message: 'Could not load memory usage.',
    data: getMemoryInfo, loaded: 'Memory',
  },
  {
    route: 'deviceStatus', Component: DeviceInfo, message: 'Could not load device information.',
    data: getDeviceStatus, loaded: 'Restart Pod',
  },
])('reports a failed $route read and offers a retry', async ({ route, Component, message, data, loaded }) => {
  server.use(http.get(`*/${route}`, () => new HttpResponse(null, { status: 503 })));
  const { user } = renderWithProviders(<Component/>);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  server.use(http.get(`*/${route}`, () => HttpResponse.json(data())));
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(loaded)).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
