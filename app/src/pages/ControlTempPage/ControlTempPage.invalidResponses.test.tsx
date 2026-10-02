import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@test/setup';
import { renderApp, renderWithProviders } from '@test/renderWithProviders';
import { getDeviceStatus, getSettings } from '../../mocks/mockData';
import { useControlTempStore } from './controlTempStore';
import { useAppStore } from '@state/appStore';
import ControlTempPage from './ControlTempPage';
import TemperatureButtons from './TemperatureButtons';

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  useControlTempStore.setState({ deviceStatus: undefined, pendingEdits: 0 });
});
describe('Invalid API data in bed controls', () => {
  it.each(['fahrenheit', 'celsius', 'level'])('never writes a temperature from string status in %s', async format => {
    let writes = 0;
    server.use(
      http.get('*/api/settings', () => HttpResponse.json({ ...getSettings(), temperatureFormat: format })),
      http.get('*/api/deviceStatus',
        () => HttpResponse.json({ ...getDeviceStatus(),
          left: { ...getDeviceStatus().left,
            targetTemperatureF: '84' } })),
      http.post('*/api/deviceStatus', () => { writes++; return HttpResponse.json({}); }),
    );
    renderWithProviders(<ControlTempPage/>);
    expect(await screen.findByText('Could not load bed status.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Warmer' })).not.toBeInTheDocument();
    expect(writes).toBe(0);
  });
  it('disables the stepper even if an invalid value reaches local control state', async () => {
    useControlTempStore.setState({ deviceStatus: { ...getDeviceStatus(),
      left: { ...getDeviceStatus().left,
        targetTemperatureF: '84' as unknown as number } } });
    renderWithProviders(<TemperatureButtons currentTargetTemp={ 84 } refetch={ () => {} }/>);
    expect(screen.getByRole('button', { name: 'Warmer' })).toHaveAttribute('aria-disabled', 'true');
  });
  it.each(['/services', '/settings', '/schedules'])('keeps temperature control usable when %s is invalid', async endpoint => {
    server.use(http.get(`*/api${endpoint}`, () => HttpResponse.json({})));
    renderApp('/');
    expect(await screen.findByRole('button', { name: 'Warmer' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Warmer' })).not.toHaveAttribute('aria-disabled'));
    expect(screen.getByRole('navigation', { name: 'Primary mobile' })).toBeVisible();
  });
});

it('disables cached controls after a malformed status refresh', async () => {
  let writes = 0;
  server.use(http.post('*/api/deviceStatus', () => { writes++; return HttpResponse.json({}); }));
  const { queryClient } = renderWithProviders(<ControlTempPage/>);
  const increase = await screen.findByRole('button', { name: 'Warmer' });
  await waitFor(() => expect(increase).not.toHaveAttribute('aria-disabled'));
  server.use(http.get('*/api/deviceStatus',
    () => HttpResponse.json({ ...getDeviceStatus(),
      left: { ...getDeviceStatus().left,
        targetTemperatureF: '84' } })));
  await queryClient.refetchQueries({ queryKey: ['useDeviceStatus'] });
  expect(await screen.findByText('Could not load bed status.')).toBeVisible();
  expect(increase).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(increase);
  expect(writes).toBe(0);
});
