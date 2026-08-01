import assert from 'node:assert/strict';
import { describe, it, before, beforeEach, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import moment from 'moment-timezone';
// Same isolated-temp-DATA_FOLDER pattern as db/services.test.ts.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-presence-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
const presenceState = {
    left: { present: false },
    right: { present: false },
};
const deviceStatus = {
    left: { isOn: true },
    right: { isOn: false },
};
let powerOffCalls = [];
let statusThrows = false;
mock.module(new URL('./frankenServer.js', import.meta.url).href, {
    namedExports: {
        getDeviceStatusCoalesced: async () => {
            if (statusThrows)
                throw new Error('franken down');
            return deviceStatus;
        },
    },
});
mock.module(new URL('../routes/metrics/presence.js', import.meta.url).href, {
    namedExports: {
        getPresenceData: () => presenceState,
    },
});
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
    namedExports: {
        updateDeviceStatus: async (update) => {
            powerOffCalls.push(update);
        },
    },
});
let settingsDB;
let schedulesDB;
let startPresenceAutoOff;
let stopPresenceAutoOff;
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MINUTE = 60_000;
before(async () => {
    ({ default: settingsDB } = await import('../db/settings.js'));
    ({ default: schedulesDB } = await import('../db/schedules.js'));
    ({ startPresenceAutoOff, stopPresenceAutoOff } = await import('./presenceAutoOffMonitor.js'));
});
beforeEach(async () => {
    powerOffCalls = [];
    statusThrows = false;
    presenceState.left = { present: false };
    presenceState.right = { present: false };
    deviceStatus.left = { isOn: true };
    deviceStatus.right = { isOn: false };
    await settingsDB.read();
    settingsDB.data.timeZone = 'UTC';
    settingsDB.data.left.awayMode = false;
    settingsDB.data.right.awayMode = false;
    await settingsDB.write();
    await schedulesDB.read();
    for (const day of DAY_NAMES) {
        schedulesDB.data.left[day] = {
            ...schedulesDB.data.left[day],
            power: { on: '21:00', off: '09:00', enabled: false, onTemperature: 82 },
        };
    }
    await schedulesDB.write();
});
// Drives N monitor ticks. The monitor only runs inside setInterval, so we
// fake setInterval + Date, then yield to the real microtask/IO queue so the
// awaits inside tick() (lowdb reads) settle before we assert.
// tick() awaits two lowdb file reads, so a couple of microtask turns is not
// enough: we need real event-loop turns (setTimeout is left unmocked) or a
// tick's tail can land in the next test and corrupt the monitor's state.
async function flush() {
    for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        await new Promise((resolve) => setImmediate(resolve));
    }
}
// The monitor keeps module-level per-side state (prevIsOn / lastSeenOnAt)
// that survives between tests in the same file. One tick with both sides
// off clears it, so each test starts from a genuine off -> on transition.
async function resetMonitorState(startEpochMs) {
    const on = { left: deviceStatus.left, right: deviceStatus.right };
    deviceStatus.left = { isOn: false };
    deviceStatus.right = { isOn: false };
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: startEpochMs - MINUTE });
    startPresenceAutoOff();
    mock.timers.tick(MINUTE);
    await flush();
    stopPresenceAutoOff();
    mock.timers.reset();
    deviceStatus.left = on.left;
    deviceStatus.right = on.right;
    powerOffCalls = [];
}
async function runTicks(startEpochMs, tickCount, onBeforeTick) {
    await resetMonitorState(startEpochMs);
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: startEpochMs });
    try {
        startPresenceAutoOff();
        for (let i = 0; i < tickCount; i++) {
            onBeforeTick?.(i);
            mock.timers.tick(MINUTE);
            // real (unmocked) macrotask turns so tick()'s async work completes
            await flush();
        }
    }
    finally {
        stopPresenceAutoOff();
        mock.timers.reset();
    }
}
const at = (iso) => moment.tz(iso, 'UTC').valueOf();
// The python stream re-POSTs the current presence state about once a minute
// (see _presence_heartbeat_interval), so while it is alive lastUpdatedAt keeps
// advancing even when nothing changes. Tests where auto-off is expected to
// fire have to model that: a fixture with a stale lastUpdatedAt means "the
// stream is down", and the monitor deliberately holds in that case.
const heartbeatAbsent = () => {
    presenceState.left = { present: false, lastUpdatedAt: moment.tz(Date.now(), 'UTC').format() };
};
describe('presenceAutoOffMonitor', () => {
    it('sanity: fires after the timeout when nobody is on the bed', async () => {
        // Side on at 14:00, no presence ever. Auto-off is meant to fire ~45min later.
        await runTicks(at('2026-03-02T14:00:00'), 50, heartbeatAbsent);
        assert.equal(powerOffCalls.length > 0, true, 'expected auto-off to fire for an empty bed');
    });
    it('does not power off while the presence stream is stale/unreported (unknown != absent)', async () => {
        // The python presence stream is down: it has never POSTed, so
        // presenceData is the module default {present:false} with no
        // lastPresenceAt. A user IS in the bed. Correct behavior: with no
        // presence evidence at all, the monitor must not shut the bed off.
        presenceState.left = { present: false }; // no lastUpdatedAt, no lastPresenceAt
        await runTicks(at('2026-03-02T14:00:00'), 60);
        assert.deepEqual(powerOffCalls, [], 'powered off with no presence data at all');
    });
    it('does not power off after a forward clock step (NTP sync after a bad-clock boot)', async () => {
        // Pod boots with a 2010 clock, user turns the side on and gets in bed,
        // then NTP steps the clock to 2026. Elapsed "no presence" time must be
        // measured from real elapsed time, not from the clock discontinuity.
        presenceState.left = { present: false, lastPresenceAt: moment.tz('2010-01-01T22:00:00', 'UTC').format() };
        await resetMonitorState(at('2010-01-01T22:01:00'));
        try {
            // First tick under the bad clock: the monitor records the side as on.
            mock.timers.enable({ apis: ['setInterval', 'Date'], now: at('2010-01-01T22:01:00') });
            startPresenceAutoOff();
            mock.timers.tick(MINUTE);
            await flush();
            stopPresenceAutoOff();
            mock.timers.reset();
            // NTP steps the clock to 2026, one minute of real time later. Same
            // process, so the monitor's per-side state carries over.
            mock.timers.enable({ apis: ['setInterval', 'Date'], now: at('2026-03-02T14:02:00') });
            startPresenceAutoOff();
            mock.timers.tick(MINUTE);
            await flush();
        }
        finally {
            stopPresenceAutoOff();
            mock.timers.reset();
        }
        assert.deepEqual(powerOffCalls, [], 'powered off because of an NTP clock step');
    });
    it('is suppressed inside an overnight power window (21:50 -> 09:50)', async () => {
        await schedulesDB.read();
        for (const day of DAY_NAMES) {
            schedulesDB.data.left[day].power = { on: '21:50', off: '09:50', enabled: true, onTemperature: 82 };
        }
        await schedulesDB.write();
        // 03:00 Monday, inside Sunday-night's window.
        await runTicks(at('2026-03-02T03:00:00'), 60);
        assert.deepEqual(powerOffCalls, [], 'auto-off fired inside the scheduled on-window');
    });
    it('is NOT suppressed all day by a morning power window (06:00 -> 09:00)', async () => {
        // A morning-only schedule. At 20:00, hours after the 09:00 off, the bed
        // is on with nobody in it: the safety net should still fire.
        await schedulesDB.read();
        for (const day of DAY_NAMES) {
            schedulesDB.data.left[day].power = { on: '06:00', off: '09:00', enabled: true, onTemperature: 82 };
        }
        await schedulesDB.write();
        await runTicks(at('2026-03-02T20:00:00'), 60, heartbeatAbsent);
        assert.equal(powerOffCalls.length > 0, true, 'auto-off suppressed long after the schedule window closed');
    });
    it('is NOT suppressed by a midday power window ending at 12:30', async () => {
        await schedulesDB.read();
        for (const day of DAY_NAMES) {
            schedulesDB.data.left[day].power = { on: '08:00', off: '12:30', enabled: true, onTemperature: 82 };
        }
        await schedulesDB.write();
        await runTicks(at('2026-03-02T18:00:00'), 60, heartbeatAbsent);
        assert.equal(powerOffCalls.length > 0, true, 'auto-off suppressed after a midday window closed');
    });
    it('does not fire when the stream goes quiet after reporting a dropout', async () => {
        // User in bed since 01:00. At 02:00 the stream reports a dropout
        // (present=false) and then stops reporting entirely. Presence is unknown
        // from that point, so the monitor must hold rather than shut the bed off.
        presenceState.left = {
            present: true,
            lastPresenceAt: moment.tz('2026-03-02T02:00:00', 'UTC').format(),
        };
        await runTicks(at('2026-03-02T02:00:00'), 60, (i) => {
            if (i === 1)
                presenceState.left.present = false;
        });
        assert.deepEqual(powerOffCalls, [], 'powered off during a presence dropout');
    });
});
//# sourceMappingURL=presenceAutoOffMonitor.test.js.map