import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import { getDeviceStatus } from '../../mocks/mockData';
import ControlTempPage from './ControlTempPage';
import { useControlTempStore } from './controlTempStore';

const notResponding = () => HttpResponse.json(
  { error: { message: 'Pod did not respond in time, retrying connection' } },
  { status: 503 },
);
const header = () => within(screen.getByRole('heading', { level: 1, name: 'Bed' }).parentElement!);

beforeEach(() => {
  // Monday 9:41 PM in the mock's Los Angeles time zone.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T04:41:00Z'));
  useAppStore.setState({ side: 'left', isUpdating: false });
  useControlTempStore.setState({ commandError: undefined, deviceStatus: undefined, pendingEdits: 0 });
});
afterEach(() => vi.useRealTimers());

it('keeps the dial and greys the last known values with their time when the Pod stops answering', async () => {
  const { queryClient, user } = renderWithProviders(<ControlTempPage/>);
  await screen.findByRole('button', { name: 'Turn off' });
  server.use(http.get('*/api/deviceStatus', notResponding));
  await queryClient.refetchQueries({ queryKey: ['useDeviceStatus'] });

  expect(await header().findByRole('status')).toHaveTextContent('Not responding');
  expect(screen.getByRole('radio', { name: 'Alex. Not responding.' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Sam. Not responding.' })).toBeInTheDocument();
  expect(screen.getByText('Last known')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: '+1' })).toBeInTheDocument();
  expect(screen.getByText('at 9:41 PM').textContent).toBe('at 9:41\u00a0PM');
  expect(screen.getByText('No response from the Pod since 9:41 PM.')).toBeInTheDocument();
  expect(screen.getByText('Schedules and alarms may not run.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Warmer' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();

  server.use(http.get('*/api/deviceStatus', () => HttpResponse.json(getDeviceStatus())));
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  expect(screen.queryByText('Last known')).not.toBeInTheDocument();
  expect(header().queryByRole('status')).not.toBeInTheDocument();
});

it('draws the frame with what it means and Try again when the first load fails', async () => {
  server.use(http.get('*/api/deviceStatus', notResponding));
  const { container } = renderWithProviders(<ControlTempPage/>);
  expect(await screen.findByText('Schedules and alarms may not run.')).toBeInTheDocument();
  expect(screen.getByText('No response from the Pod since 9:41 PM.')).toBeInTheDocument();
  expect(header().getByRole('status')).toHaveTextContent('Not responding');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Turn o/ })).not.toBeInTheDocument();
  expect(container.querySelector('[data-dial] h2')).toBeNull();
  expect(container.querySelector('[data-dial] path[data-band="off"]')).not.toBeNull();
});
