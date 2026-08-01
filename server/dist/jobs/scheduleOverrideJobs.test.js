import assert from 'node:assert/strict';
import { describe, it, before, beforeEach, after, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import moment from 'moment-timezone';
import nodeSchedule from 'node-schedule';
// Same isolated-temp-DATA_FOLDER pattern as db/services.test.ts.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-override-probe-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
const deviceUpdates = [];
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
    namedExports: {
        updateDeviceStatus: async (update) => {
            deviceUpdates.push(update);
        },
    },
});
let settingsDB;
let scheduleTemperatures;
let schedulePowerOn;
let isTempScheduleOverridden;
before(async () => {
    ({ default: settingsDB } = await import('../db/settings.js'));
    ({ scheduleTemperatures } = await import('./temperatureScheduler.js'));
    ({ schedulePowerOn } = await import('./powerScheduler.js'));
    ({ isTempScheduleOverridden } = await import('./scheduleOverride.js'));
});
async function setOverride(side, expiresAt) {
    await settingsDB.read();
    settingsDB.data[side].scheduleOverrides.temperatureSchedules = { disabled: true, expiresAt };
    await settingsDB.write();
}
beforeEach(async () => {
    deviceUpdates.length = 0;
    Object.keys(nodeSchedule.scheduledJobs).forEach((name) => nodeSchedule.cancelJob(name));
    await settingsDB.read();
    settingsDB.data.timeZone = 'UTC';
    for (const side of ['left', 'right']) {
        settingsDB.data[side].awayMode = false;
        settingsDB.data[side].scheduleOverrides.temperatureSchedules = { disabled: false, expiresAt: '' };
    }
    await settingsDB.write();
});
after(() => {
    Object.keys(nodeSchedule.scheduledJobs).forEach((name) => nodeSchedule.cancelJob(name));
});
async function flush() {
    for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        await new Promise((resolve) => setImmediate(resolve));
    }
}
// Fires a scheduled job's body immediately instead of waiting for its
// recurrence, so the job body itself (not just the predicate) is covered.
async function invokeJob(name) {
    const job = nodeSchedule.scheduledJobs[name];
    assert.ok(job, `job ${name} was never scheduled`);
    job.invoke();
    await flush();
}
// The 22:00 adjustment sits inside a 21:00 to 09:00 night, so it resolves
// to the schedule's own day.
const POWER = { on: '21:00', off: '09:00', enabled: true, onTemperature: 82 };
describe('temperature override vs the jobs it is meant to suppress', () => {
    it('suppresses a scheduled temperature adjustment while active', async () => {
        await setOverride('left', moment().add(1, 'hour').format());
        scheduleTemperatures(settingsDB.data, 'left', 'monday', { '22:00': 90 }, POWER);
        await invokeJob('left-monday-22:00-90-temperature-adjustment');
        assert.deepEqual(deviceUpdates, [], 'temperature job ran while overridden');
    });
    it('runs a scheduled temperature adjustment once the override has expired', async () => {
        await setOverride('left', moment().subtract(1, 'minute').format());
        scheduleTemperatures(settingsDB.data, 'left', 'monday', { '22:00': 90 }, POWER);
        await invokeJob('left-monday-22:00-90-temperature-adjustment');
        assert.equal(deviceUpdates.length, 1, 'temperature job stayed suppressed past expiry');
    });
    it('does not let one side\'s override suppress the other side', async () => {
        await setOverride('left', moment().add(1, 'hour').format());
        scheduleTemperatures(settingsDB.data, 'right', 'monday', { '22:00': 90 }, POWER);
        await invokeJob('right-monday-22:00-90-temperature-adjustment');
        assert.equal(deviceUpdates.length, 1, 'right side suppressed by the left side override');
    });
    it('treats a malformed expiresAt as no override', async () => {
        await setOverride('left', 'not-a-timestamp');
        assert.equal(isTempScheduleOverridden('left'), false);
    });
    it('does not let the power-on job re-apply its scheduled temperature while overridden', async () => {
        // The user manually set a temperature minutes ago, so the schedule is
        // paused. The power-on job still pushes power.onTemperature, undoing
        // the manual change the override exists to protect.
        await setOverride('left', moment().add(6, 'hours').format());
        schedulePowerOn(settingsDB.data, 'left', 'monday', {
            on: '21:00', off: '09:00', enabled: true, onTemperature: 95,
        });
        await invokeJob('left-monday-21:00-power-on');
        const temps = deviceUpdates.map((u) => u.left?.targetTemperatureF);
        assert.deepEqual(temps.filter((t) => t !== undefined), [], 'power-on job overwrote the manual temperature');
    });
});
//# sourceMappingURL=scheduleOverrideJobs.test.js.map