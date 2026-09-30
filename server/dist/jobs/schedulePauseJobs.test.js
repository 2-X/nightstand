import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import moment from 'moment-timezone';
import nodeSchedule from 'node-schedule';
const dataFolder = mkdtempSync(path.join(tmpdir(), 'nightstand-pause-jobs-'));
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
let schedulePowerOn;
let schedulePowerOff;
let resetPowerOnTimes;
let trackAlarm;
let resetAlarmActivity;
let scheduleTemperatures;
before(async () => {
    ({ default: settingsDB } = await import('../db/settings.js'));
    ({ schedulePowerOn, schedulePowerOff, resetPowerOnTimes } = await import('./powerScheduler.js'));
    ({ scheduleTemperatures } = await import('./temperatureScheduler.js'));
    ({ trackAlarm, resetAlarmActivity } = await import('./alarmActivity.js'));
});
const POWER = { on: '21:00', off: '07:00', enabled: true, onTemperature: 82 };
async function setPause(side, active, expiresAt = '') {
    await settingsDB.read();
    settingsDB.data[side].scheduleOverrides.pause = { active, expiresAt };
    await settingsDB.write();
}
async function invokeJob(name) {
    const job = nodeSchedule.scheduledJobs[name];
    assert.ok(job, `job ${name} was never scheduled`);
    await job.invoke();
}
beforeEach(async () => {
    deviceUpdates.length = 0;
    Object.keys(nodeSchedule.scheduledJobs).forEach((name) => nodeSchedule.cancelJob(name));
    // A power on run by an earlier test would make a power off in the same
    // minute skip as "the next session already started".
    resetPowerOnTimes();
    resetAlarmActivity();
    await settingsDB.read();
    settingsDB.data.timeZone = 'UTC';
    for (const side of ['left', 'right']) {
        settingsDB.data[side].awayMode = false;
        settingsDB.data[side].scheduleOverrides.temperatureSchedules = { disabled: false, expiresAt: '' };
        settingsDB.data[side].scheduleOverrides.pause = { active: false, expiresAt: '' };
    }
    await settingsDB.write();
});
after(() => {
    Object.keys(nodeSchedule.scheduledJobs).forEach((name) => nodeSchedule.cancelJob(name));
    rmSync(dataFolder, { recursive: true, force: true });
});
describe('schedule pause at fire time', () => {
    it('skips power on while paused until resumed', async () => {
        schedulePowerOn(settingsDB.data, 'left', 'monday', POWER);
        await setPause('left', true);
        await invokeJob('left-monday-21:00-power-on');
        assert.deepEqual(deviceUpdates, []);
    });
    it('skips power off while paused until a later time', async () => {
        schedulePowerOff(settingsDB.data, 'left', 'monday', POWER);
        await setPause('left', true, moment().add(2, 'hours').format());
        await invokeJob('left-monday-07:00-power-off');
        assert.deepEqual(deviceUpdates, []);
    });
    it('skips a temperature change while paused', async () => {
        scheduleTemperatures(settingsDB.data, 'left', 'monday', { '23:00': 70 }, POWER);
        await setPause('left', true);
        await invokeJob('left-monday-23:00-70-temperature-adjustment');
        assert.deepEqual(deviceUpdates, []);
    });
    it('skips the warm-up before wake while paused', async () => {
        scheduleTemperatures(settingsDB.data, 'left', 'monday', { '06:30': 90 }, POWER);
        await setPause('left', true);
        await invokeJob('left-monday-06:30-90-temperature-adjustment');
        assert.deepEqual(deviceUpdates, []);
    });
    it('reads the pause when the job fires, not when it was built', async () => {
        schedulePowerOn(settingsDB.data, 'left', 'monday', POWER);
        await setPause('left', true);
        await invokeJob('left-monday-21:00-power-on');
        assert.deepEqual(deviceUpdates, []);
        await setPause('left', false);
        await invokeJob('left-monday-21:00-power-on');
        assert.deepEqual(deviceUpdates, [{ left: { isOn: true, targetTemperatureF: 82 } }]);
    });
    it('runs jobs again once the pause has ended', async () => {
        schedulePowerOff(settingsDB.data, 'left', 'monday', POWER);
        await setPause('left', true, moment().subtract(1, 'minute').format());
        await invokeJob('left-monday-07:00-power-off');
        assert.deepEqual(deviceUpdates, [{ left: { isOn: false } }]);
    });
    it('runs a power off due exactly at the end of the pause', async () => {
        schedulePowerOff(settingsDB.data, 'left', 'monday', POWER);
        const end = moment().subtract(1, 'minute').startOf('minute');
        await setPause('left', true, end.format());
        const job = nodeSchedule.scheduledJobs['left-monday-07:00-power-off'];
        await job.invoke(end.toDate());
        assert.deepEqual(deviceUpdates, [{ left: { isOn: false } }]);
    });
    it('judges a power off by the minute it was due, not by when it ran', async () => {
        schedulePowerOff(settingsDB.data, 'left', 'monday', POWER);
        await setPause('left', true, moment().subtract(1, 'minute').format());
        // As node-schedule does: the job receives the time it was due.
        const job = nodeSchedule.scheduledJobs['left-monday-07:00-power-off'];
        await job.invoke(moment().subtract(5, 'minutes').toDate());
        assert.deepEqual(deviceUpdates, []);
    });
    it('judges a power on and a temperature change by the minute they were due', async () => {
        schedulePowerOn(settingsDB.data, 'left', 'monday', POWER);
        scheduleTemperatures(settingsDB.data, 'left', 'monday', { '23:00': 70 }, POWER);
        await setPause('left', true, moment().subtract(1, 'minute').format());
        const due = moment().subtract(5, 'minutes').toDate();
        await nodeSchedule.scheduledJobs['left-monday-21:00-power-on'].invoke(due);
        await nodeSchedule.scheduledJobs['left-monday-23:00-70-temperature-adjustment'].invoke(due);
        assert.deepEqual(deviceUpdates, []);
    });
    it('leaves the partner side on its schedule', async () => {
        schedulePowerOn(settingsDB.data, 'left', 'monday', POWER);
        scheduleTemperatures(settingsDB.data, 'left', 'monday', { '23:00': 70 }, POWER);
        await setPause('right', true);
        await invokeJob('left-monday-21:00-power-on');
        await invokeJob('left-monday-23:00-70-temperature-adjustment');
        assert.deepEqual(deviceUpdates, [
            { left: { isOn: true, targetTemperatureF: 82 } },
            { left: { targetTemperatureF: 70 } },
        ]);
    });
    it('records a skipped power on, so a power off due in its minute stays skipped', async () => {
        schedulePowerOn(settingsDB.data, 'left', 'monday', POWER);
        schedulePowerOff(settingsDB.data, 'left', 'monday', POWER);
        const due = moment().startOf('minute').toDate();
        const on = nodeSchedule.scheduledJobs['left-monday-21:00-power-on'];
        const off = nodeSchedule.scheduledJobs['left-monday-07:00-power-off'];
        await setPause('left', true);
        await on.invoke(due);
        await setPause('left', false);
        await off.invoke(due);
        assert.deepEqual(deviceUpdates, []);
    });
    it('lets an alarm due in its minute ring before a paused power off skips', async () => {
        schedulePowerOff(settingsDB.data, 'left', 'monday', POWER);
        await setPause('left', true);
        let endAlarm;
        const alarmRun = new Promise((resolve) => { endAlarm = () => resolve(0); });
        const alarm = trackAlarm('left', 'left-monday-07:00-alarm', () => alarmRun);
        const off = nodeSchedule.scheduledJobs['left-monday-07:00-power-off'];
        let finished = false;
        const offDone = off.invoke(moment().startOf('minute').toDate()).then(() => { finished = true; });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(finished, false);
        endAlarm();
        await alarm;
        await offDone;
        assert.deepEqual(deviceUpdates, []);
    });
});
//# sourceMappingURL=schedulePauseJobs.test.js.map