import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { useControlTempStore } from './controlTempStore.tsx';
import type { DeviceStatus } from '@api/deviceStatusSchema.ts';
import { useAppStore } from '@state/appStore.tsx';
import * as deviceStatusApi from '@api/deviceStatus.ts';
import AlarmDismissal from './AlarmDismissal.tsx';

function makeStatus(alarmVibrating: boolean): DeviceStatus {
  const side = {
    currentTemperatureLevel: 0,
    currentTemperatureF: 82,
    targetTemperatureF: 84,
    secondsRemaining: 0,
    isOn: true,
    isAlarmVibrating: alarmVibrating,
  };
  return {
    left: { ...side, isAlarmVibrating: alarmVibrating },
    right: { ...side },
    waterLevel: 'good',
    isPriming: false,
    settings: { v: 1, gainLeft: 1, gainRight: 1, ledBrightness: 1 },
    coverVersion: '1',
    hubVersion: '1',
    freeSleep: { version: '3.0.0', branch: 'main' },
    wifiStrength: -50,
    sensorTemps: null,
  } as DeviceStatus;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(deviceStatusApi, 'postDeviceStatus').mockResolvedValue({} as Awaited<ReturnType<typeof deviceStatusApi.postDeviceStatus>>);
  useAppStore.setState({ side: 'left', isUpdating: false });
  useControlTempStore.setState({ deviceStatus: makeStatus(true), pendingEdits: 0 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function advanceDismissal() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

describe('AlarmDismissal repeat alarm', () => {
  it('re-opens the dismissal dialog when a new alarm fires after a prior dismissal', async () => {
    renderWithProviders(<AlarmDismissal refetch={ () => Promise.resolve() } />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss alarm/i }));
    await advanceDismissal();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => useControlTempStore.setState({ deviceStatus: makeStatus(false) }));
    act(() => useControlTempStore.setState({ deviceStatus: makeStatus(true) }));
    expect(screen.getByRole('button', { name: /dismiss alarm/i })).toBeInTheDocument();
  });
});

for (const initial of ['left', 'right'] as const) {
  it(`still shows the other side after dismissing ${initial}`, async () => {
    useAppStore.setState({ side: initial });
    renderWithProviders(<AlarmDismissal refetch={ () => Promise.resolve() } />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss alarm/i }));
    await advanceDismissal();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const other = initial === 'left' ? 'right' : 'left';
    act(() => useAppStore.setState({ side: other }));
    expect(screen.getByRole('dialog', { name: `${other === 'left' ? 'Left' : 'Right'} side alarm` })).toBeInTheDocument();
    act(() => useAppStore.setState({ side: initial }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => useAppStore.setState({ side: other }));
    const stopped = makeStatus(true);
    stopped[initial].isAlarmVibrating = false;
    act(() => useControlTempStore.setState({ deviceStatus: stopped }));
    act(() => useControlTempStore.setState({ deviceStatus: makeStatus(true) }));
    act(() => useAppStore.setState({ side: initial }));
    expect(screen.getByRole('dialog', { name: `${initial === 'left' ? 'Left' : 'Right'} side alarm` })).toBeInTheDocument();
  });
}

it('keeps the other side visible when switching during a dismiss request', async () => {
  let finishRequest!: (value: Awaited<ReturnType<typeof deviceStatusApi.postDeviceStatus>>) => void;
  vi.mocked(deviceStatusApi.postDeviceStatus).mockReturnValue(new Promise(resolve => { finishRequest = resolve; }));
  renderWithProviders(<AlarmDismissal refetch={ () => Promise.resolve() } />);
  fireEvent.click(screen.getByRole('button', { name: /dismiss alarm/i }));
  expect(useAppStore.getState().isUpdating).toBe(true);
  act(() => useAppStore.setState({ side: 'right' }));
  await act(async () => finishRequest({} as Awaited<ReturnType<typeof deviceStatusApi.postDeviceStatus>>));
  await advanceDismissal();
  expect(useAppStore.getState().isUpdating).toBe(false);
  expect(screen.getByRole('dialog', { name: 'Right side alarm' })).toBeInTheDocument();
  act(() => useAppStore.setState({ side: 'left' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
