import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TemperatureButtons from './TemperatureButtons';
import { useAppStore } from '@state/appStore';
import { useControlTempStore } from './controlTempStore';
import { getDeviceStatus } from '../../mocks/mockData';

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/deviceStatus.ts', () => ({ postDeviceStatus: api.post }));
vi.mock('@api/settings.ts', () => ({ useSettings: () => ({ data: { temperatureFormat: 'fahrenheit', left: { awayMode: false } } }) }));
beforeEach(() => {
  vi.useFakeTimers();
  api.post.mockReset().mockResolvedValue({});
  useAppStore.setState({ side: 'left', isUpdating: false });
  useControlTempStore.setState({
    deviceStatus: { ...getDeviceStatus(), left: { ...getDeviceStatus().left, targetTemperatureF: 80 } }, pendingEdits: 0,
  });
});
afterEach(() => vi.useRealTimers());
it('queues taps while a previous temperature request is pending', async () => {
  let resolve!: () => void;
  api.post.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  render(<TemperatureButtons currentTargetTemp={ 80 } refetch={ vi.fn() }/>);
  const increase = screen.getByRole('button', { name: 'Increase temperature' });
  fireEvent.click(increase);
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(api.post).toHaveBeenCalledWith({ left: { targetTemperatureF: 81 } });
  expect(increase).toBeEnabled();
  fireEvent.click(increase);
  fireEvent.click(increase);
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(); await vi.advanceTimersByTimeAsync(2000); });
  expect(api.post).toHaveBeenLastCalledWith({ left: { targetTemperatureF: 83 } });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(useControlTempStore.getState().pendingEdits).toBe(0);
});
it('reverts a failed request to the latest reported target', async () => {
  const view = render(<TemperatureButtons currentTargetTemp={ 80 } refetch={ vi.fn() }/>);
  act(() => useControlTempStore.getState().setDeviceStatus({ left: { targetTemperatureF: 86 } }));
  view.rerender(<TemperatureButtons currentTargetTemp={ 86 } refetch={ vi.fn() }/>);
  api.post.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Increase temperature' }));
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(useControlTempStore.getState().deviceStatus?.left.targetTemperatureF).toBe(86);
});
