import assert from 'node:assert/strict';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Exercises scheduleDeadlineRefires: the deadline re-fire loop that keeps
// buzzing at full intensity every 45s (up to 10 min) until dismissed. Uses
// fake timers to advance through the loop deterministically; franken +
// deviceApi are mocked so no hardware is touched.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-refire-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
const alarmCommands = [];
mock.module(new URL('../8sleep/deviceApi.js', import.meta.url).href, {
    namedExports: {
        executeFunction: async (command, arg = 'empty') => { alarmCommands.push({ command, arg }); },
    },
});
let sideIsOn = true;
mock.module(new URL('../8sleep/frankenServer.js', import.meta.url).href, {
    namedExports: {
        connectFranken: async () => ({
            getDeviceStatus: async () => ({
                left: { isOn: sideIsOn },
                right: { isOn: sideIsOn },
            }),
        }),
    },
});
const refireEvents = [];
mock.module(new URL('../db/collector.js', import.meta.url).href, {
    namedExports: {
        recordEvent: (type, opts) => {
            if (type === 'refire')
                refireEvents.push(opts.payload ?? {});
        },
        recordConfigAudit: () => { },
    },
});
// armVibe + smartWakeController are pulled in by alarmScheduler; stub them.
mock.module(new URL('./armVibe.js', import.meta.url).href, {
    namedExports: { armVibe: async () => { } },
});
mock.module(new URL('../8sleep/smartWakeController.js', import.meta.url).href, {
    namedExports: {
        startSmartWakeSession: async () => { },
        stopSmartWakeSession: () => { },
        notifySmartWakeDismissed: () => { },
        stopAllSmartWakeSessions: () => { },
    },
});
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
    namedExports: { updateDeviceStatus: async () => { } },
});
let scheduleDeadlineRefires;
let memoryDB;
let settingsDB;
const realSetTimeout = globalThis.setTimeout;
async function drain() {
    for (let i = 0; i < 20; i++) {
        await new Promise((r) => realSetTimeout(r, 1));
        await new Promise((r) => setImmediate(r));
    }
}
before(async () => {
    ({ scheduleDeadlineRefires } = await import('./alarmScheduler.js'));
    ({ default: memoryDB } = await import('../db/memoryDB.js'));
    ({ default: settingsDB } = await import('../db/settings.js'));
    await settingsDB.read();
    settingsDB.data.timeZone = 'UTC';
    settingsDB.data.left.awayMode = false;
    await settingsDB.write();
});
beforeEach(() => {
    alarmCommands.length = 0;
    refireEvents.length = 0;
    sideIsOn = true;
    // Fake BOTH setTimeout and Date so the loop's Date.now()-based cap check
    // advances in lockstep with the ticked timers.
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 });
});
afterEach(() => {
    mock.timers.reset();
});
const alarmCmds = () => alarmCommands.filter((c) => c.command === 'ALARM_LEFT');
describe('scheduleDeadlineRefires', () => {
    it('re-fires on the 45s cadence until dismissed', async () => {
        const firedAt = Date.now();
        memoryDB.data.left.lastAlarmFiredAt = firedAt;
        memoryDB.data.left.lastAlarmDismissedAt = undefined;
        await memoryDB.write();
        scheduleDeadlineRefires({
            side: 'left', firedAt, vibrationIntensity: 100, duration: 60, vibrationPattern: 'rise',
        });
        // Advance three 45s intervals => three re-fires.
        for (let i = 0; i < 3; i++) {
            mock.timers.tick(45_000);
            await drain();
        }
        assert.ok(alarmCmds().length >= 3, `expected >=3 re-fires, got ${alarmCmds().length}`);
        // Dismiss: record a dismissal newer than firedAt. The next interval stops.
        const before = alarmCmds().length;
        memoryDB.data.left.lastAlarmDismissedAt = Date.now();
        await memoryDB.write();
        mock.timers.tick(45_000);
        await drain();
        mock.timers.tick(45_000);
        await drain();
        assert.equal(alarmCmds().length, before, 're-fires continued after dismissal');
        assert.ok(refireEvents.some((e) => e.stopped === 'dismissed'), 'a dismissed stop was journaled');
    });
    it('stops at the 10-minute cap even if never dismissed', async () => {
        const firedAt = Date.now();
        memoryDB.data.left.lastAlarmFiredAt = firedAt;
        memoryDB.data.left.lastAlarmDismissedAt = undefined;
        await memoryDB.write();
        scheduleDeadlineRefires({
            side: 'left', firedAt, vibrationIntensity: 100, duration: 60, vibrationPattern: 'rise',
        });
        // Advance well past 10 minutes (14 intervals * 45s = 630s > 600s cap).
        for (let i = 0; i < 14; i++) {
            mock.timers.tick(45_000);
            await drain();
        }
        // At most ceil(600/45) = 14 re-fires; the loop must have stopped by the cap.
        assert.ok(refireEvents.some((e) => e.stopped === 'max_elapsed'), 'a max-elapsed stop was journaled');
        const capCount = alarmCmds().length;
        // Further ticks produce no more re-fires.
        mock.timers.tick(45_000);
        await drain();
        assert.equal(alarmCmds().length, capCount, 're-fires continued past the cap');
    });
});
//# sourceMappingURL=deadlineRefire.test.js.map