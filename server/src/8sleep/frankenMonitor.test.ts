import assert from 'node:assert/strict';
import { describe, it, before, beforeEach, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { DeviceStatus, SideStatus } from '../routes/deviceStatus/deviceStatusSchema.js';

// Same isolated-temp-DATA_FOLDER pattern as db/services.test.ts.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-franken-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';

let updateRejectsWith: Error | null = null;
let updateCalls = 0;
let writtenTargets: number[] = [];

mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: {
    updateDeviceStatus: async (patch: { left?: { targetTemperatureF?: number }; right?: { targetTemperatureF?: number } }) => {
      updateCalls += 1;
      const target = patch?.left?.targetTemperatureF ?? patch?.right?.targetTemperatureF;
      if (typeof target === 'number') writtenTargets.push(target);
      if (updateRejectsWith) throw updateRejectsWith;
    },
  },
});

// The real module constructs a TriMixBaseControl at import time, and that
// constructor starts an unawaited BLE initialize(). This file measures
// unhandled rejections, so an unrelated one from the base would be read as
// the bug under test.
mock.module(new URL('./trimixBaseControl.js', import.meta.url).href, {
  namedExports: {
    trimixBase: {
      goToFlat: async () => {},
      setPosition: async () => {},
    },
  },
});

let FrankenMonitor: typeof import('./frankenMonitor.js')['FrankenMonitor'];
let settingsDB: typeof import('../db/settings.js')['default'];
let serverStatus: typeof import('../serverStatus.js')['default'];
let optimisticTargets: typeof import('./optimisticTargets.js');

before(async () => {
  ({ FrankenMonitor } = await import('./frankenMonitor.js'));
  ({ default: settingsDB } = await import('../db/settings.js'));
  ({ default: serverStatus } = await import('../serverStatus.js'));
  optimisticTargets = await import('./optimisticTargets.js');
});

const side = (taps: SideStatus['taps']): SideStatus => ({
  currentTemperatureLevel: 0,
  currentTemperatureF: 82,
  targetTemperatureF: 82,
  secondsRemaining: 0,
  isOn: true,
  isAlarmVibrating: false,
  taps,
});

const deviceStatus = (leftTaps: SideStatus['taps']): DeviceStatus => ({
  left: side(leftTaps),
  right: side({ doubleTap: 0, tripleTap: 0, quadTap: 0 }),
  waterLevel: 'true',
  isPriming: false,
  settings: { v: 1, gainLeft: 0, gainRight: 0, ledBrightness: 100 },
  coverVersion: '1',
  hubVersion: '1',
  freeSleep: { version: '3.0.1', branch: 'main' },
  wifiStrength: 70,
  sensorTemps: null,
});

// A rejection is only reported as unhandled once the microtask queue has
// drained and the process has had a real turn, so yield past both.
async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Wait (bounded) for a detached gesture chain to finish its writes; sequential
// gestures do real settings/schedule file reads between writes, so a fixed
// yield count is not enough under a loaded full-suite run.
async function waitForWrites(count: number) {
  const deadline = Date.now() + 5_000;
  while (writtenTargets.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// Drives the private gesture path directly. The public entry point is the
// 2s poll loop, which would need a live Franken socket to reach this code.
type GestureInternals = {
  deviceStatus?: DeviceStatus;
  processGestures(next: DeviceStatus): void;
};

async function runGestureTick(previous: DeviceStatus, next: DeviceStatus) {
  const monitor = new FrankenMonitor() as unknown as GestureInternals;
  monitor.deviceStatus = previous;

  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    monitor.processGestures(next);
    await settle();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return seen;
}

describe('FrankenMonitor gesture handling', () => {
  beforeEach(async () => {
    updateRejectsWith = null;
    updateCalls = 0;
    writtenTargets = [];
    optimisticTargets.clearAll();
    serverStatus.status.frankenMonitor.status = 'healthy';
    serverStatus.status.frankenMonitor.message = '';

    await settingsDB.read();
    settingsDB.data.left.taps.doubleTap = { type: 'temperature', change: 'decrement', amount: 2 };
    await settingsDB.write();
  });

  it('applies a temperature tap when the tap counter changes', async () => {
    const seen = await runGestureTick(
      deviceStatus({ doubleTap: 1, tripleTap: 0, quadTap: 0 }),
      deviceStatus({ doubleTap: 2, tripleTap: 0, quadTap: 0 }),
    );

    assert.equal(updateCalls, 1, 'expected the tap to reach updateDeviceStatus');
    assert.deepEqual(seen, []);
  });

  // Newer host firmware reports cover long-presses as tap gestures. Two of
  // them in one 2 s snapshot used to be computed from the same base (live:
  // -24 -> -16 and -24 -> -24 written back to back). They must stack.
  it('stacks two gestures from one tick instead of applying both to the same base', async () => {
    settingsDB.data.left.taps.tripleTap = { type: 'temperature', change: 'increment', amount: 1 };
    await settingsDB.write();
    const seen = await runGestureTick(
      deviceStatus({ doubleTap: 1, tripleTap: 1, quadTap: 0 }),
      deviceStatus({ doubleTap: 2, tripleTap: 2, quadTap: 0 }),
    );
    assert.deepEqual(seen, []);
    await waitForWrites(2);
    // base 82: doubleTap -2 -> 80, then tripleTap +1 from 80 -> 81.
    assert.deepEqual(writtenTargets, [80, 81]);
    // The optimistic target is set after the write's manual-override
    // bookkeeping resolves, so give the chain a moment to finish.
    await settle();
    assert.equal(optimisticTargets.getFreshOptimisticTarget('left'), 81);
  });

  it('bases a gesture on a fresh optimistic target from a cover-button press', async () => {
    optimisticTargets.setOptimisticTarget('left', 70);
    const seen = await runGestureTick(
      deviceStatus({ doubleTap: 1, tripleTap: 0, quadTap: 0 }),
      deviceStatus({ doubleTap: 2, tripleTap: 0, quadTap: 0 }),
    );
    assert.deepEqual(seen, []);
    await waitForWrites(1);
    assert.deepEqual(writtenTargets, [68]);
  });

  it('ignores a tick where no tap counter moved', async () => {
    const unchanged = deviceStatus({ doubleTap: 1, tripleTap: 0, quadTap: 0 });
    const seen = await runGestureTick(unchanged, deviceStatus({ doubleTap: 1, tripleTap: 0, quadTap: 0 }));

    assert.equal(updateCalls, 0);
    assert.deepEqual(seen, []);
  });

  // The regression this file exists for. processGesture runs detached so a
  // slow base move cannot stall the poll loop, which means the surrounding
  // try cannot catch its rejection. server.ts handles unhandledRejection by
  // shutting the process down, and the unit restarts it, so before this was
  // caught a tap that failed to write bounced the whole server.
  it('does not leave an unhandled rejection when a tap fails to write', async () => {
    updateRejectsWith = new Error('franken write failed');

    const seen = await runGestureTick(
      deviceStatus({ doubleTap: 1, tripleTap: 0, quadTap: 0 }),
      deviceStatus({ doubleTap: 2, tripleTap: 0, quadTap: 0 }),
    );

    assert.equal(updateCalls, 1, 'expected the tap to have been attempted');
    assert.deepEqual(seen, [], 'a failed tap escaped as an unhandled rejection');
  });

  it('reports a failed tap on the service status instead of staying healthy', async () => {
    updateRejectsWith = new Error('franken write failed');

    await runGestureTick(
      deviceStatus({ doubleTap: 1, tripleTap: 0, quadTap: 0 }),
      deviceStatus({ doubleTap: 2, tripleTap: 0, quadTap: 0 }),
    );

    assert.equal(serverStatus.status.frankenMonitor.status, 'failed');
    assert.match(serverStatus.status.frankenMonitor.message, /franken write failed/);
  });

  it('still handles a rejection when both sides tap in the same tick', async () => {
    updateRejectsWith = new Error('franken write failed');
    await settingsDB.read();
    settingsDB.data.right.taps.doubleTap = { type: 'temperature', change: 'increment', amount: 2 };
    await settingsDB.write();

    const previous = deviceStatus({ doubleTap: 1, tripleTap: 0, quadTap: 0 });
    const next = deviceStatus({ doubleTap: 2, tripleTap: 0, quadTap: 0 });
    next.right = side({ doubleTap: 5, tripleTap: 0, quadTap: 0 });

    const seen = await runGestureTick(previous, next);

    assert.equal(updateCalls, 2, 'expected both sides to be attempted');
    assert.deepEqual(seen, []);
  });
});
