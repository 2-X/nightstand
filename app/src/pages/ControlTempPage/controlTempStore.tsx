import _ from 'lodash';
import { create } from 'zustand';
import { DeepPartial } from 'ts-essentials';
import { DeviceStatus } from '@api/deviceStatusSchema.ts';
import type { Side } from '@state/appStore.tsx';


type ControlTempStore = {
  deviceStatus: DeviceStatus | undefined;
  pendingEdits: number;
  // When a side was last turned off from the Bed page, so the analysis
  // prompt can follow it without living next to the power button.
  poweredOff: { side: Side; at: number } | undefined;
  // Why the last power or temperature change did not reach the Pod.
  commandError: string | undefined;
  setCommandError: (message: string | undefined) => void;
  markPoweredOff: (side: Side) => void;
  clearPoweredOff: () => void;
  setDeviceStatus: (newDeviceStatus: DeepPartial<DeviceStatus>) => void;
  beginEdit: () => void;
  endEdit: () => void;
  syncFromServer: (next: DeviceStatus) => void;
};

export const useControlTempStore = create<ControlTempStore>((set, get) => ({
  deviceStatus: undefined,
  pendingEdits: 0,
  poweredOff: undefined,
  commandError: undefined,
  setCommandError: (commandError) => set({ commandError }),
  markPoweredOff: (side) => set({ poweredOff: { side, at: Date.now() } }),
  clearPoweredOff: () => set({ poweredOff: undefined }),
  setDeviceStatus: (newDeviceStatus) => {
    const { deviceStatus } = get();
    // Merge into a fresh object: mutating `deviceStatus` in place would store
    // the same reference back, entangling optimistic and server state and
    // defeating referential change detection.
    const updatedDeviceStatus = _.merge({}, deviceStatus, newDeviceStatus);
    set({ deviceStatus: updatedDeviceStatus });
  },
  beginEdit: () => set((s) => ({ pendingEdits: s.pendingEdits + 1 })),
  endEdit: () => set((s) => ({ pendingEdits: Math.max(0, s.pendingEdits - 1) })),
  // Server-pushed state. While the user has an edit in flight, ignore it,
  // a stale push from the FrankenMonitor poll would otherwise clobber the
  // optimistic value the user just typed/tapped.
  syncFromServer: (next) => {
    if (get().pendingEdits > 0) return;
    set({ deviceStatus: next });
  },
}));
