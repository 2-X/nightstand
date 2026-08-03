import assert from 'node:assert/strict';
import { describe, it, before, beforeEach, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Same isolated-temp-DATA_FOLDER pattern as db/services.test.ts.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-franken-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
let updateRejectsWith = null;
let updateCalls = 0;
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
    namedExports: {
        updateDeviceStatus: async () => {
            updateCalls += 1;
            if (updateRejectsWith)
                throw updateRejectsWith;
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
            goToFlat: async () => { },
            setPosition: async () => { },
        },
    },
});
let FrankenMonitor;
let settingsDB;
let serverStatus;
before(async () => {
    ({ FrankenMonitor } = await import('./frankenMonitor.js'));
    ({ default: settingsDB } = await import('../db/settings.js'));
    ({ default: serverStatus } = await import('../serverStatus.js'));
});
const side = (taps) => ({
    currentTemperatureLevel: 0,
    currentTemperatureF: 82,
    targetTemperatureF: 82,
    secondsRemaining: 0,
    isOn: true,
    isAlarmVibrating: false,
    taps,
});
const deviceStatus = (leftTaps) => ({
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
async function runGestureTick(previous, next) {
    const monitor = new FrankenMonitor();
    monitor.deviceStatus = previous;
    const seen = [];
    const onUnhandled = (reason) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
        monitor.processGestures(next);
        await settle();
    }
    finally {
        process.off('unhandledRejection', onUnhandled);
    }
    return seen;
}
describe('FrankenMonitor gesture handling', () => {
    beforeEach(async () => {
        updateRejectsWith = null;
        updateCalls = 0;
        serverStatus.status.frankenMonitor.status = 'healthy';
        serverStatus.status.frankenMonitor.message = '';
        await settingsDB.read();
        settingsDB.data.left.taps.doubleTap = { type: 'temperature', change: 'decrement', amount: 2 };
        await settingsDB.write();
    });
    it('applies a temperature tap when the tap counter changes', async () => {
        const seen = await runGestureTick(deviceStatus({ doubleTap: 1, tripleTap: 0, quadTap: 0 }), deviceStatus({ doubleTap: 2, tripleTap: 0, quadTap: 0 }));
        assert.equal(updateCalls, 1, 'expected the tap to reach updateDeviceStatus');
        assert.deepEqual(seen, []);
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
        const seen = await runGestureTick(deviceStatus({ doubleTap: 1, tripleTap: 0, quadTap: 0 }), deviceStatus({ doubleTap: 2, tripleTap: 0, quadTap: 0 }));
        assert.equal(updateCalls, 1, 'expected the tap to have been attempted');
        assert.deepEqual(seen, [], 'a failed tap escaped as an unhandled rejection');
    });
    it('reports a failed tap on the service status instead of staying healthy', async () => {
        updateRejectsWith = new Error('franken write failed');
        await runGestureTick(deviceStatus({ doubleTap: 1, tripleTap: 0, quadTap: 0 }), deviceStatus({ doubleTap: 2, tripleTap: 0, quadTap: 0 }));
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
//# sourceMappingURL=frankenMonitor.test.js.map