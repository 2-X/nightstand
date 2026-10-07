import assert from 'node:assert/strict';
import { after, beforeEach, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-prime-scheduler-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
let rebootError;
mock.module(new URL('./reboot.js', import.meta.url).href, {
    defaultExport: async () => { if (rebootError)
        throw rebootError; },
});
// Captures the callbacks instead of scheduling them, so no real timer can fire.
const jobs = new Map();
mock.module('node-schedule', { defaultExport: {
        RecurrenceRule: class {
        },
        scheduledJobs: {},
        scheduleJob: (name, _rule, callback) => { jobs.set(name, callback); },
    } });
const { schedulePrimingRebootAndCalibration } = await import('./primeScheduler.js');
const { default: settingsDB } = await import('../db/settings.js');
const { default: serverStatus } = await import('../serverStatus.js');
after(() => { rmSync(folder, { recursive: true, force: true }); });
beforeEach(async () => {
    jobs.clear();
    rebootError = undefined;
    settingsDB.data.rebootDaily = true;
    settingsDB.data.timeZone = 'America/Los_Angeles';
    settingsDB.data.primePodDaily = { enabled: true, time: '14:00' };
    await settingsDB.write();
    serverStatus.status.alarmSchedule.status = 'healthy';
    serverStatus.status.alarmSchedule.message = 'Alarms scheduled';
    serverStatus.status.rebootSchedule.status = 'not_started';
    serverStatus.status.rebootSchedule.message = 'Previous failure';
});
async function runDailyReboot() {
    schedulePrimingRebootAndCalibration(settingsDB.data);
    const job = [...jobs].find(([name]) => name.startsWith('daily-reboot-'))?.[1];
    assert.ok(job, 'expected a daily reboot job');
    await job();
}
it('reports a failed daily reboot without changing alarm health', async () => {
    rebootError = new Error('Reboot failed');
    const alarmBefore = { ...serverStatus.status.alarmSchedule };
    await runDailyReboot();
    assert.equal(serverStatus.status.rebootSchedule.status, 'failed');
    assert.equal(serverStatus.status.rebootSchedule.message, 'Reboot failed');
    assert.deepEqual(serverStatus.status.alarmSchedule, alarmBefore);
});
it('reports a successful daily reboot without changing alarm health', async () => {
    const alarmBefore = { ...serverStatus.status.alarmSchedule };
    await runDailyReboot();
    assert.equal(serverStatus.status.rebootSchedule.status, 'healthy');
    assert.equal(serverStatus.status.rebootSchedule.message, '');
    assert.deepEqual(serverStatus.status.alarmSchedule, alarmBefore);
});
//# sourceMappingURL=primeScheduler.test.js.map