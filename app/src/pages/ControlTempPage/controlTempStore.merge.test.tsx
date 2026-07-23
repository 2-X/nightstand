import { describe, it, expect, beforeEach } from 'vitest';
import { useControlTempStore } from './controlTempStore.tsx';
import type { DeviceStatus } from '@api/deviceStatusSchema.ts';

function makeStatus(over: Partial<DeviceStatus> = {}): DeviceStatus {
  return {
    left: {
      currentTemperatureLevel: 0,
      currentTemperatureF: 82,
      targetTemperatureF: 84,
      secondsRemaining: 0,
      isOn: true,
      isAlarmVibrating: false,
    },
    right: {
      currentTemperatureLevel: 0,
      currentTemperatureF: 85,
      targetTemperatureF: 86,
      secondsRemaining: 0,
      isOn: true,
      isAlarmVibrating: false,
    },
    waterLevel: 'good',
    isPriming: false,
    settings: { v: 1, gainLeft: 1, gainRight: 1, ledBrightness: 1 },
    coverVersion: '1',
    hubVersion: '1',
    freeSleep: { version: '3.0.0', branch: 'main' },
    wifiStrength: -50,
    sensorTemps: null,
    ...over,
  } as DeviceStatus;
}

describe('controlTempStore', () => {
  beforeEach(() => {
    useControlTempStore.setState({ deviceStatus: undefined, pendingEdits: 0 });
  });

  it('setDeviceStatus does not mutate the object handed to syncFromServer (cache safety)', () => {
    const server = makeStatus();
    const snapshot = JSON.parse(JSON.stringify(server));
    useControlTempStore.getState().syncFromServer(server);
    useControlTempStore.getState().setDeviceStatus({ left: { targetTemperatureF: 99 } });
    // The server object (which is the shared React Query cache entry) must be untouched.
    expect(server).toEqual(snapshot);
    expect(useControlTempStore.getState().deviceStatus?.left.targetTemperatureF).toBe(99);
    // The other side must be preserved after a single-side edit.
    expect(useControlTempStore.getState().deviceStatus?.right.targetTemperatureF).toBe(86);
  });

  it('syncFromServer is ignored while an edit is pending, honored once it settles', () => {
    const s1 = makeStatus({ left: makeStatus().left });
    useControlTempStore.getState().syncFromServer(s1);
    useControlTempStore.getState().beginEdit();
    useControlTempStore.getState().setDeviceStatus({ left: { targetTemperatureF: 100 } });

    // A stale server push arrives mid-edit: must be ignored.
    const stale = makeStatus();
    stale.left.targetTemperatureF = 70;
    useControlTempStore.getState().syncFromServer(stale);
    expect(useControlTempStore.getState().deviceStatus?.left.targetTemperatureF).toBe(100);

    // Edit settles.
    useControlTempStore.getState().endEdit();
    expect(useControlTempStore.getState().pendingEdits).toBe(0);

    // A fresh server push is now honored.
    const fresh = makeStatus();
    fresh.left.targetTemperatureF = 88;
    useControlTempStore.getState().syncFromServer(fresh);
    expect(useControlTempStore.getState().deviceStatus?.left.targetTemperatureF).toBe(88);
  });
});
