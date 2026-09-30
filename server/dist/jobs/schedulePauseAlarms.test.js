import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import moment from 'moment-timezone';
import nodeSchedule from 'node-schedule';
const dataFolder = mkdtempSync(path.join(tmpdir(), 'nightstand-pause-alarms-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
const commands = [];
mock.module(new URL('../8sleep/deviceApi.js', import.meta.url).href, {
    namedExports: { executeFunction: async (...args) => { commands.push(args); } },
});
// alarmScheduler connects through connectFrankenWithin since 3.4.0.
mock.module(new URL('../8sleep/frankenServer.js', import.meta.url).href, {
    namedExports: { connectFrankenWithin: async () => ({
            getDeviceStatus: async () => ({ left: { isOn: true }, right: { isOn: true } }),
        }) },
});
const deviceUpdates = [];
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
    namedExports: { updateDeviceStatus: async (update) => { deviceUpdates.push(update); } },
});
let settingsDB;
let resetAlarmActivity;
let scheduleAlarm;
let scheduleAlarmOverride;
let scheduleOneOffAlarm;
let schedulePowerOff;
before(async () => {
    ({ default: settingsDB } = await import('../db/settings.js'));
    ({ scheduleAlarm, scheduleAlarmOverride, scheduleOneOffAlarm } = await import('./alarmScheduler.js'));
    ({ resetAlarmActivity } = await import('./alarmActivity.js'));
    ({ schedulePowerOff } = await import('./powerScheduler.js'));
});
const alarm = {
    time: '07:00', enabled: true, vibrationIntensity: 100,
    duration: 10, vibrationPattern: 'rise', alarmTemperature: 80,
};
// Each test rings at its own time: executeAlarm refuses to ring one
// occurrence twice in a day.
const night = (time) => ({
    power: { on: '21:00', off: '09:00', enabled: true, onTemperature: 82 },
    temperatures: {}, alarm: { ...alarm, time }, alarms: [{ ...alarm, time }],
});
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
    commands.length = 0;
    deviceUpdates.length = 0;
    Object.keys(nodeSchedule.scheduledJobs).forEach((name) => nodeSchedule.cancelJob(name));
    resetAlarmActivity();
    await settingsDB.read();
    settingsDB.data.timeZone = 'UTC';
    for (const side of ['left', 'right']) {
        settingsDB.data[side].awayMode = false;
        settingsDB.data[side].alarmsEnabled = true;
        settingsDB.data[side].scheduleOverrides = {
            temperatureSchedules: { disabled: false, expiresAt: '' },
            alarm: { disabled: false, timeOverride: '', expiresAt: '' },
            pause: { active: false, expiresAt: '' },
        };
        settingsDB.data[side].oneOffAlarm.enabled = false;
    }
    await settingsDB.write();
});
after(() => {
    Object.keys(nodeSchedule.scheduledJobs).forEach((name) => nodeSchedule.cancelJob(name));
    rmSync(dataFolder, { recursive: true, force: true });
});
describe('schedule pause and alarms', () => {
    it('skips a recurring alarm while paused', async (t) => {
        t.mock.method(globalThis, 'setTimeout', () => ({ unref() { } }));
        scheduleAlarm(settingsDB.data, 'left', 'monday', night('06:10'));
        await setPause('left', true);
        await invokeJob('left-monday-06:10-0-alarm');
        assert.equal(commands.length, 0);
    });
    it('rings a recurring alarm once the pause has ended', async (t) => {
        t.mock.method(globalThis, 'setTimeout', () => ({ unref() { } }));
        scheduleAlarm(settingsDB.data, 'left', 'monday', night('06:20'));
        await setPause('left', true, moment().subtract(1, 'minute').format());
        await invokeJob('left-monday-06:20-0-alarm');
        assert.equal(commands.length, 1);
    });
    it('skips a recurring alarm due exactly at the end of the pause', async (t) => {
        t.mock.method(globalThis, 'setTimeout', () => ({ unref() { } }));
        scheduleAlarm(settingsDB.data, 'left', 'monday', night('06:40'));
        // The pause ended a minute ago, so a fire-time check alone would ring it.
        const end = moment.utc().subtract(1, 'minute').startOf('minute');
        await setPause('left', true, end.format());
        // As node-schedule does: the job receives the time it was due.
        const job = nodeSchedule.scheduledJobs['left-monday-06:40-0-alarm'];
        await job.invoke(end.toDate());
        assert.equal(commands.length, 0);
    });
    it('rings a recurring alarm due a minute after the pause ended', async (t) => {
        t.mock.method(globalThis, 'setTimeout', () => ({ unref() { } }));
        scheduleAlarm(settingsDB.data, 'left', 'monday', night('06:50'));
        const end = moment.utc().subtract(1, 'minute').startOf('minute');
        await setPause('left', true, end.format());
        const job = nodeSchedule.scheduledJobs['left-monday-06:50-0-alarm'];
        await job.invoke(end.clone().add(1, 'minute').toDate());
        assert.equal(commands.length, 1);
    });
    it('rings the partner side while one side is paused', async (t) => {
        t.mock.method(globalThis, 'setTimeout', () => ({ unref() { } }));
        scheduleAlarm(settingsDB.data, 'left', 'monday', night('06:30'));
        await setPause('right', true);
        await invokeJob('left-monday-06:30-0-alarm');
        assert.equal(commands.length, 1);
    });
    it('skips the per-night alarm override while paused', async (t) => {
        t.mock.method(globalThis, 'setTimeout', () => ({ unref() { } }));
        const timeOverride = moment.utc().add(1, 'hour').format('HH:mm');
        await settingsDB.read();
        settingsDB.data.left.scheduleOverrides.alarm = {
            disabled: false, timeOverride, expiresAt: moment.utc().add(2, 'hours').format(),
        };
        await settingsDB.write();
        scheduleAlarmOverride(settingsDB.data, 'left');
        await setPause('left', true);
        await invokeJob(`left-alarm-override-${timeOverride}`);
        assert.equal(commands.length, 0);
    });
    it('skips the per-night alarm override due exactly at the end of the pause', async (t) => {
        t.mock.method(globalThis, 'setTimeout', () => ({ unref() { } }));
        const timeOverride = moment.utc().add(1, 'hour').format('HH:mm');
        await settingsDB.read();
        settingsDB.data.left.scheduleOverrides.alarm = {
            disabled: false, timeOverride, expiresAt: moment.utc().add(2, 'hours').format(),
        };
        await settingsDB.write();
        scheduleAlarmOverride(settingsDB.data, 'left');
        const end = moment.utc().subtract(1, 'minute').startOf('minute');
        await setPause('left', true, end.format());
        const job = nodeSchedule.scheduledJobs[`left-alarm-override-${timeOverride}`];
        await job.invoke(end.toDate());
        assert.equal(commands.length, 0);
    });
    it('does not hold up a power off in the same minute as a paused alarm', async () => {
        // "Tonight only": the pause ends at the turn-off minute, which still
        // turns the side off, while the alarm due in that minute is silenced.
        const wakeNight = { ...night('06:00'), power: { on: '21:00', off: '06:00', enabled: true, onTemperature: 82 } };
        scheduleAlarm(settingsDB.data, 'left', 'monday', wakeNight);
        schedulePowerOff(settingsDB.data, 'left', 'monday', wakeNight.power);
        const alarmJob = nodeSchedule.scheduledJobs['left-monday-06:00-0-alarm'];
        const offJob = nodeSchedule.scheduledJobs['left-monday-06:00-power-off'];
        const due = new Date(alarmJob.nextInvocation().getTime());
        assert.equal(offJob.nextInvocation().getTime(), due.getTime());
        await setPause('left', true, moment.utc(due).format());
        const powerOff = offJob.invoke(due);
        await alarmJob.invoke(due);
        let timer;
        const limit = new Promise(resolve => { timer = setTimeout(() => resolve('waiting'), 2_000); });
        const outcome = await Promise.race([powerOff.then(() => 'done'), limit]);
        clearTimeout(timer);
        assert.equal(outcome, 'done', 'the power off waited on a paused alarm');
        assert.equal(commands.length, 0);
        assert.deepEqual(deviceUpdates, [{ left: { isOn: false } }]);
    });
    it('still rings the one-time alarm while paused', async (t) => {
        t.mock.method(globalThis, 'setTimeout', () => ({ unref() { } }));
        await settingsDB.read();
        settingsDB.data.left.oneOffAlarm = {
            enabled: true, fireAt: moment().add(1, 'hour').format(), vibrationIntensity: 50, vibrationPattern: 'rise', duration: 30,
        };
        await settingsDB.write();
        scheduleOneOffAlarm(settingsDB.data, 'left');
        await setPause('left', true);
        await invokeJob('left-one-off-alarm');
        assert.equal(commands.length, 1);
    });
});
//# sourceMappingURL=schedulePauseAlarms.test.js.map