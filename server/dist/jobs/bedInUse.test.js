import assert from 'node:assert/strict';
import { describe, it, before, beforeEach, after, mock } from 'node:test';
import nodeSchedule from 'node-schedule';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-in-use-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
let connected = true;
let status = { left: { isOn: false }, right: { isOn: false } };
mock.module(new URL('../8sleep/frankenServer.js', import.meta.url).href, {
    namedExports: {
        isFrankenConnected: () => connected,
        getDeviceStatusCoalesced: async () => { if (status instanceof Error)
            throw status; return status; },
    },
});
const { startAlarmLedger, alarmLedgerHeartbeat, resetAlarmLedgerForTests } = await import('./alarmLedger.js');
const { setRebuilding } = await import('./rebuildState.js');
const ledgerFile = path.join(dataFolder, 'alarm-ledger.json');
// The jobs are planned and the ledger is vouching for the job list.
const planned = () => {
    resetAlarmLedgerForTests();
    setRebuilding(false);
    startAlarmLedger(new Date());
    alarmLedgerHeartbeat(new Date());
};
let bedInUseReasons;
let alarmDueWithin;
before(async () => ({ bedInUseReasons, alarmDueWithin } = await import('./bedInUse.js')));
const cancelJobs = () => Object.keys(nodeSchedule.scheduledJobs).forEach(name => nodeSchedule.cancelJob(name));
after(() => { cancelJobs(); resetAlarmLedgerForTests(); });
beforeEach(() => {
    connected = true;
    status = { left: { isOn: false }, right: { isOn: false } };
    cancelJobs();
    rmSync(ledgerFile, { force: true });
    planned();
});
describe('bedInUseReasons', () => {
    it('is empty for an idle bed with no alarm near', async () => {
        assert.deepEqual(await bedInUseReasons(), []);
    });
    it('names each side that is on', async () => {
        status = { left: { isOn: true }, right: { isOn: true } };
        assert.deepEqual(await bedInUseReasons(), ['left-on', 'right-on']);
    });
    it('counts an alarm due within 15 minutes, of any kind', async () => {
        nodeSchedule.scheduleJob('rhythm-left-2026-10-05-alarm-0630-0', new Date(Date.now() + 10 * 60_000), () => undefined);
        assert.deepEqual(await bedInUseReasons(), ['alarm-soon']);
        nodeSchedule.cancelJob('rhythm-left-2026-10-05-alarm-0630-0');
        nodeSchedule.scheduleJob('right-alarm-override-1', new Date(Date.now() + 5 * 60_000), () => undefined);
        assert.deepEqual(await bedInUseReasons(), ['alarm-soon']);
    });
    it('ignores an alarm further away and jobs that are not alarms', async () => {
        nodeSchedule.scheduleJob('left-monday-alarm', new Date(Date.now() + 20 * 60_000), () => undefined);
        nodeSchedule.scheduleJob('left-monday-21:00-power-on', new Date(Date.now() + 60_000), () => undefined);
        assert.deepEqual(await bedInUseReasons(), []);
    });
    it('reports a side that is on together with an alarm that is near', async () => {
        status = { left: { isOn: true }, right: { isOn: false } };
        nodeSchedule.scheduleJob('right-monday-alarm', new Date(Date.now() + 60_000), () => undefined);
        assert.deepEqual(await bedInUseReasons(), ['left-on', 'alarm-soon']);
    });
    it('treats an unreadable state as possibly in use', async () => {
        connected = false;
        assert.deepEqual(await bedInUseReasons(), ['status-unknown']);
        connected = true;
        status = new Error('timeout');
        assert.deepEqual(await bedInUseReasons(), ['status-unknown']);
        status = {};
        assert.deepEqual(await bedInUseReasons(), ['status-unknown']);
    });
    it('still sees a near alarm when the state is unreadable', async () => {
        connected = false;
        nodeSchedule.scheduleJob('left-monday-alarm', new Date(Date.now() + 60_000), () => undefined);
        assert.deepEqual(await bedInUseReasons(), ['status-unknown', 'alarm-soon']);
    });
});
describe('when the ledger cannot vouch for the job list', () => {
    const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
    it('is unknown before the first plan, even with no alarm known', async () => {
        resetAlarmLedgerForTests();
        startAlarmLedger(new Date());
        assert.deepEqual(await bedInUseReasons(), ['status-unknown']);
    });
    it('is unknown when the ledger was never started', async () => {
        resetAlarmLedgerForTests();
        assert.deepEqual(await bedInUseReasons(), ['status-unknown']);
    });
    it('counts a saved alarm that is near before the first plan', async () => {
        resetAlarmLedgerForTests();
        writeFileSync(ledgerFile, JSON.stringify({
            version: 1, aliveAt: inMinutes(-1),
            upcoming: [{ side: 'left', at: inMinutes(5), jobName: 'left-monday-alarm' }], started: [], missed: [],
        }));
        startAlarmLedger(new Date());
        assert.deepEqual(await bedInUseReasons(), ['status-unknown', 'alarm-soon']);
    });
    it('ignores a saved alarm that is far off before the first plan', async () => {
        resetAlarmLedgerForTests();
        writeFileSync(ledgerFile, JSON.stringify({
            version: 1, aliveAt: inMinutes(-1),
            upcoming: [{ side: 'left', at: inMinutes(60), jobName: 'left-monday-alarm' }], started: [], missed: [],
        }));
        startAlarmLedger(new Date());
        assert.deepEqual(await bedInUseReasons(), ['status-unknown']);
    });
    it('is unknown while the jobs are re-planned, using the alarms saved at the last plan', async () => {
        nodeSchedule.scheduleJob('left-monday-alarm', new Date(Date.now() + 5 * 60_000), () => undefined);
        alarmLedgerHeartbeat(new Date());
        cancelJobs();
        setRebuilding(true);
        try {
            assert.deepEqual(await bedInUseReasons(), ['status-unknown', 'alarm-soon']);
        }
        finally {
            setRebuilding(false);
        }
    });
    it('is unknown while re-planned even with no alarm saved', async () => {
        setRebuilding(true);
        try {
            assert.deepEqual(await bedInUseReasons(), ['status-unknown']);
        }
        finally {
            setRebuilding(false);
        }
    });
    it('does not repeat status-unknown when the bed is unreadable too', async () => {
        connected = false;
        setRebuilding(true);
        try {
            assert.deepEqual(await bedInUseReasons(), ['status-unknown']);
        }
        finally {
            setRebuilding(false);
        }
    });
});
describe('alarmDueWithin', () => {
    it('includes the window edge and excludes the past', () => {
        const now = new Date();
        nodeSchedule.scheduleJob('left-monday-alarm', new Date(now.getTime() + 15 * 60_000), () => undefined);
        assert.equal(alarmDueWithin(now, 15 * 60_000), true);
        assert.equal(alarmDueWithin(new Date(now.getTime() - 1000), 15 * 60_000), false);
        assert.equal(alarmDueWithin(new Date(now.getTime() + 60_000), 15 * 60_000), true);
    });
});
//# sourceMappingURL=bedInUse.test.js.map