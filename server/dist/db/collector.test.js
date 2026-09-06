import assert from 'node:assert/strict';
import { describe, it, before, beforeEach, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Same isolated-temp-DATA_FOLDER pattern as the other server tests.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-collector-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
const captured = { bed: [], hub: [], events: [], audit: [] };
let failNextTransaction = false;
const makeCreateMany = (bucket) => async ({ data }) => {
    captured[bucket].push(...data);
    return { count: data.length };
};
mock.module(new URL('./prisma.js', import.meta.url).href, {
    namedExports: {
        prisma: {
            bed_state_samples: { createMany: makeCreateMany('bed') },
            hub_state_samples: { createMany: makeCreateMany('hub') },
            pod_events: { createMany: makeCreateMany('events') },
            config_audit: { createMany: makeCreateMany('audit') },
            $transaction: async (ops) => {
                if (failNextTransaction) {
                    failNextTransaction = false;
                    throw new Error('simulated db failure');
                }
                // The collector passes createMany() promises; awaiting them runs the
                // capture side effects above.
                return Promise.all(ops);
            },
        },
    },
});
let onDeviceStatus;
let recordEvent;
let recordConfigAudit;
let flush;
before(async () => {
    ({ onDeviceStatus, recordEvent, recordConfigAudit, flush } = await import('./collector.js'));
});
const makeSide = (over = {}) => ({
    currentTemperatureLevel: 0,
    currentTemperatureF: 82,
    targetTemperatureF: 82,
    secondsRemaining: 0,
    isOn: true,
    isAlarmVibrating: false,
    ...over,
});
const makeStatus = (over = {}) => ({
    left: makeSide(),
    right: makeSide(),
    waterLevel: 'true',
    isPriming: false,
    settings: { v: 1, gainLeft: 0, gainRight: 0, ledBrightness: 100 },
    coverVersion: '1',
    hubVersion: '1',
    freeSleep: { version: '3.0.1', branch: 'main' },
    wifiStrength: 70,
    sensorTemps: null,
    ...over,
});
// The collector diffs against module-level "last written" state, which
// persists across tests. Each test resets captured buckets and then seeds a
// fresh baseline snapshot (the first snapshot always writes + seeds derive
// state), so assertions start from a known point.
beforeEach(async () => {
    captured.bed.length = 0;
    captured.hub.length = 0;
    captured.events.length = 0;
    captured.audit.length = 0;
    failNextTransaction = false;
});
describe('collector on-change / heartbeat sampling', () => {
    it('writes a bed sample per side on the first snapshot', async () => {
        onDeviceStatus(makeStatus());
        await flush();
        const left = captured.bed.filter((r) => r.side === 'left');
        const right = captured.bed.filter((r) => r.side === 'right');
        assert.equal(left.length, 1);
        assert.equal(right.length, 1);
    });
    it('suppresses an unchanged bed sample within the heartbeat window', async () => {
        // Baseline already written by the previous test's snapshot; feed an
        // identical snapshot and confirm nothing new is queued.
        onDeviceStatus(makeStatus());
        await flush();
        assert.equal(captured.bed.length, 0, 'identical snapshot should not write');
    });
    it('writes a bed sample when the target level changes', async () => {
        onDeviceStatus(makeStatus({ left: makeSide({ targetTemperatureF: 95 }) }));
        await flush();
        const left = captured.bed.filter((r) => r.side === 'left');
        assert.equal(left.length, 1);
        assert.equal(left[0].target_temp_f, 95);
        // right side unchanged -> not written
        assert.equal(captured.bed.filter((r) => r.side === 'right').length, 0);
    });
    it('writes a bed sample when isOn changes', async () => {
        onDeviceStatus(makeStatus({ left: makeSide({ targetTemperatureF: 95, isOn: false }) }));
        await flush();
        const left = captured.bed.filter((r) => r.side === 'left');
        assert.equal(left.length, 1);
        assert.equal(left[0].is_on, false);
    });
    it('forces a heartbeat sample after 60s with no change', async () => {
        // Freeze/advance the clock: the collector uses Date.now() for both the
        // timestamp and the heartbeat comparison.
        const realNow = Date.now;
        try {
            // Use a timestamp far in the future so it dominates any "last written"
            // state left over from earlier tests, and force a value change on the
            // seed snapshot so it definitely writes and reseeds lastBed at `base`.
            const base = 4_000_000_000_000;
            Date.now = () => base;
            onDeviceStatus(makeStatus({ left: makeSide({ targetTemperatureF: 70 }), right: makeSide({ targetTemperatureF: 70 }) }));
            await flush();
            captured.bed.length = 0;
            // +30s: unchanged, under heartbeat -> no write
            Date.now = () => base + 30_000;
            onDeviceStatus(makeStatus({ left: makeSide({ targetTemperatureF: 70 }), right: makeSide({ targetTemperatureF: 70 }) }));
            await flush();
            assert.equal(captured.bed.length, 0, 'under 60s heartbeat should suppress');
            // +61s: unchanged, past heartbeat -> both sides write
            Date.now = () => base + 61_000;
            onDeviceStatus(makeStatus({ left: makeSide({ targetTemperatureF: 70 }), right: makeSide({ targetTemperatureF: 70 }) }));
            await flush();
            assert.equal(captured.bed.filter((r) => r.side === 'left').length, 1);
            assert.equal(captured.bed.filter((r) => r.side === 'right').length, 1);
        }
        finally {
            Date.now = realNow;
        }
    });
});
describe('collector hub sampling', () => {
    it('writes a hub sample on wifi/water/priming change', async () => {
        onDeviceStatus(makeStatus()); // baseline
        await flush();
        captured.hub.length = 0;
        onDeviceStatus(makeStatus({ wifiStrength: 42 }));
        await flush();
        assert.equal(captured.hub.length, 1);
        assert.equal(captured.hub[0].wifi_strength, 42);
        assert.equal(captured.hub[0].water_ok, true);
    });
});
describe('collector derived transition events', () => {
    it('emits power_off then power_on on isOn transitions', async () => {
        onDeviceStatus(makeStatus({ left: makeSide({ isOn: true }) })); // seed
        await flush();
        captured.events.length = 0;
        onDeviceStatus(makeStatus({ left: makeSide({ isOn: false }) }));
        await flush();
        const off = captured.events.filter((e) => e.type === 'power_off' && e.side === 'left');
        assert.equal(off.length, 1);
        onDeviceStatus(makeStatus({ left: makeSide({ isOn: true }) }));
        await flush();
        const on = captured.events.filter((e) => e.type === 'power_on' && e.side === 'left');
        assert.equal(on.length, 1);
    });
    it('emits water_low / water_ok and prime_start / prime_end on transitions', async () => {
        onDeviceStatus(makeStatus({ waterLevel: 'true', isPriming: false })); // seed
        await flush();
        captured.events.length = 0;
        onDeviceStatus(makeStatus({ waterLevel: 'false', isPriming: true }));
        await flush();
        assert.equal(captured.events.filter((e) => e.type === 'water_low').length, 1);
        assert.equal(captured.events.filter((e) => e.type === 'prime_start').length, 1);
        onDeviceStatus(makeStatus({ waterLevel: 'true', isPriming: false }));
        await flush();
        assert.equal(captured.events.filter((e) => e.type === 'water_ok').length, 1);
        assert.equal(captured.events.filter((e) => e.type === 'prime_end').length, 1);
    });
});
describe('collector fire-and-forget writers', () => {
    it('records events and audits, parsing payloads back out on flush', async () => {
        recordEvent('alarm_fired', { side: 'left', payload: { intensity: 80 }, source: 'test' });
        recordConfigAudit('settings', 'POST /api/settings', { foo: 'bar' });
        await flush();
        const alarm = captured.events.find((e) => e.type === 'alarm_fired');
        assert.ok(alarm);
        assert.equal(alarm.side, 'left');
        assert.deepEqual(JSON.parse(alarm.payload), { intensity: 80 });
        const audit = captured.audit.find((a) => a.kind === 'settings');
        assert.ok(audit);
        assert.deepEqual(JSON.parse(audit.snapshot), { foo: 'bar' });
    });
    it('never throws out of flush when the DB transaction fails', async () => {
        recordEvent('boot', { payload: { version: '3.1.0' }, source: 'test' });
        failNextTransaction = true;
        // Must resolve, not reject: an unhandled rejection would shut the server down.
        await assert.doesNotReject(() => flush());
    });
});
//# sourceMappingURL=collector.test.js.map