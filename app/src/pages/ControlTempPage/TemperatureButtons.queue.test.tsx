import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TemperatureButtons from './TemperatureButtons';
import { useAppStore } from '@state/appStore';
import { useControlTempStore } from './controlTempStore';
import { getDeviceStatus } from '../../mocks/mockData';
import { TemperatureFormat } from '@lib/temperatureConversions';

const api = vi.hoisted(() => ({ post: vi.fn() }));
const preferences = vi.hoisted(() => ({ format: 'fahrenheit' as TemperatureFormat }));
vi.mock('@api/deviceStatus.ts', () => ({ postDeviceStatus: api.post }));
vi.mock('@api/settings.ts', () => ({
  useSettings: () => ({ data: { temperatureFormat: preferences.format, left: { awayMode: false }, right: { awayMode: false } } }),
}));
beforeEach(() => {
  vi.useFakeTimers();
  preferences.format = 'fahrenheit';
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
it('drops a queued temperature write when status becomes unavailable', async () => {
  const view = render(<TemperatureButtons currentTargetTemp={ 80 } refetch={ vi.fn() }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Increase temperature' }));
  view.rerender(<TemperatureButtons currentTargetTemp={ 80 } refetch={ vi.fn() } statusUnavailable/>);
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(api.post).not.toHaveBeenCalled();
  expect(useControlTempStore.getState().pendingEdits).toBe(0);
  expect(screen.getByRole('button', { name: 'Increase temperature' })).toBeDisabled();
});

it.each(['Increase', 'Decrease'])('restores the exact 60 F target after a level %s and its inverse', async first => {
  preferences.format = 'level';
  useControlTempStore.getState().setDeviceStatus({ left: { targetTemperatureF: 60 } });
  render(<TemperatureButtons currentTargetTemp={ 60 } refetch={ vi.fn() }/>);
  fireEvent.click(screen.getByRole('button', { name: `${first} temperature` }));
  fireEvent.click(screen.getByRole('button', { name: `${first === 'Increase' ? 'Decrease' : 'Increase'} temperature` }));
  expect(useControlTempStore.getState().deviceStatus?.left.targetTemperatureF).toBe(60);
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(api.post).toHaveBeenCalledExactlyOnceWith({ left: { targetTemperatureF: 60 } });
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(useControlTempStore.getState().pendingEdits).toBe(0);
});

it('discards level history after an external target changes away and back', () => {
  preferences.format = 'level';
  useControlTempStore.getState().setDeviceStatus({ left: { targetTemperatureF: 60 } });
  render(<TemperatureButtons currentTargetTemp={ 60 } refetch={ vi.fn() }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Increase temperature' }));
  expect(useControlTempStore.getState().deviceStatus?.left.targetTemperatureF).toBe(63);
  act(() => useControlTempStore.getState().setDeviceStatus({ left: { targetTemperatureF: 70 } }));
  act(() => useControlTempStore.getState().setDeviceStatus({ left: { targetTemperatureF: 63 } }));
  fireEvent.click(screen.getByRole('button', { name: 'Decrease temperature' }));
  expect(useControlTempStore.getState().deviceStatus?.left.targetTemperatureF).toBe(61);
});

it('does not carry level history across sides with matching targets', () => {
  preferences.format = 'level';
  useControlTempStore.getState().setDeviceStatus({ left: { targetTemperatureF: 60 }, right: { targetTemperatureF: 63 } });
  render(<TemperatureButtons currentTargetTemp={ 60 } refetch={ vi.fn() }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Increase temperature' }));
  act(() => useAppStore.setState({ side: 'right' }));
  fireEvent.click(screen.getByRole('button', { name: 'Decrease temperature' }));
  expect(useControlTempStore.getState().deviceStatus?.right.targetTemperatureF).toBe(61);
  expect(useControlTempStore.getState().deviceStatus?.left.targetTemperatureF).toBe(63);
});

it('discards level history when the display format changes away and back', () => {
  preferences.format = 'level';
  useControlTempStore.getState().setDeviceStatus({ left: { targetTemperatureF: 60 } });
  const view = render(<TemperatureButtons currentTargetTemp={ 60 } refetch={ vi.fn() }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Increase temperature' }));
  preferences.format = 'celsius';
  view.rerender(<TemperatureButtons currentTargetTemp={ 63 } refetch={ vi.fn() }/>);
  preferences.format = 'level';
  view.rerender(<TemperatureButtons currentTargetTemp={ 63 } refetch={ vi.fn() }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Decrease temperature' }));
  expect(useControlTempStore.getState().deviceStatus?.left.targetTemperatureF).toBe(61);
});
