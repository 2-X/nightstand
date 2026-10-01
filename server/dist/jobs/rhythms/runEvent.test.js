import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-rhythm-events-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const updates = [];
const updateOptions = [];
const commands = [];
const analyses = [];
const deviceStatus = { left: { isOn: true }, right: { isOn: true } };
const pod = { connected: true };
mock.module(new URL('../../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
    namedExports: {
        updateDeviceStatus: async (value, options) => {
            updates.push(value);
            updateOptions.push(options);
        },
    },
});
mock.module(new URL('../../8sleep/deviceApi.js', import.meta.url).href, {
    namedExports: { executeFunction: async (...args) => { commands.push(args); } },
});
mock.module(new URL('../../8sleep/frankenServer.js', import.meta.url).href, {
    namedExports: {
        connectFrankenWithin: async () => {
            if (!pod.connected)
                throw new Error('Pod hardware is not connected; gave up after 120s');
            pod.onConnect?.();
            return { getDeviceStatus: async () => deviceStatus };
        },
        getDeviceStatusCoalesced: async () => deviceStatus,
    },
});
mock.module(new URL('../analyzeSleep.js', import.meta.url).href, {
    namedExports: { executeAnalyzeSleep: (...args) => { analyses.push(args); } },
});
const { default: settingsDB } = await import('../../db/settings.js');
const { default: schedulesDB } = await import('../../db/schedules.js');
const { default: servicesDB } = await import('../../db/services.js');
const { default: memoryDB } = await import('../../db/memoryDB.js');
const { resolveSleeps } = await import('./resolve.js');
const { everyNight, testNight, testRhythmsDB } = await import('./testSupport.js');
const { ANALYSIS_MAX_WINDOW_MS, REANALYSIS_DELAY_MS, firmwareSeconds, rearmRhythmSleep, resetOffTimes, runRhythmEvent, runSleepAnalysis, } = await import('./runEvent.js');
const { hasAlarmOccurrence, resetAlarmOccurrences } = await import('../alarmScheduler.js');
const { resetAlarmActivity } = await import('../alarmActivity.js');
const { resetPowerOnTimes } = await import('../powerScheduler.js');
const { setEngineActivation } = await import('../scheduleQueries.js');
const at = (iso) => new Date(iso);
const setNow = (iso) => mock.timers.setTime(Date.parse(iso));
const noTimers = () => ({ unref() { } });
const alarmCommands = (name) => commands.filter(([command]) => command === name).length;
function sleepOn(date) {
    const night = testNight('22:00', '06:00', { temperatures: { '02:00': 72 }, alarms: ['05:45'] });
    const from = at(`${date}T12:00:00Z`);
    const sleep = resolveSleeps({
        db: testRhythmsDB(schedulesDB.data, everyNight(night)),
        side: 'left', timeZone: 'UTC', from, to: new Date(from.getTime() + 24 * 3600_000),
    }).find(candidate => candidate.date === date);
    assert.ok(sleep, `no sleep resolved for ${date}`);
    return sleep;
}
function eventOf(sleep, kind) {
    const event = sleep.events.find(candidate => candidate.kind === kind);
    assert.ok(event, `no ${kind} event`);
    return event;
}
beforeEach(async () => {
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T12:00:00Z') });
    resetAlarmActivity();
    resetAlarmOccurrences();
    resetPowerOnTimes();
    resetOffTimes();
    pod.connected = true;
    pod.onConnect = undefined;
    updates.length = 0;
    updateOptions.length = 0;
    commands.length = 0;
    analyses.length = 0;
    deviceStatus.left.isOn = true;
    deviceStatus.right.isOn = true;
    settingsDB.data.timeZone = 'UTC';
    for (const side of ['left', 'right']) {
        settingsDB.data[side].awayMode = false;
        settingsDB.data[side].alarmsEnabled = true;
        settingsDB.data[side].scheduleOverrides = {
            temperatureSchedules: { disabled: false, expiresAt: '' },
            alarm: { disabled: false, timeOverride: '', expiresAt: '' },
            pause: { active: false, expiresAt: '' },
        };
    }
    await settingsDB.write();
    servicesDB.data.biometrics.enabled = true;
    await servicesDB.write();
    memoryDB.data.left = { isAlarmVibrating: false, analyzeSleep: {} };
    memoryDB.data.right = { isAlarmVibrating: false, analyzeSleep: {} };
    await memoryDB.write();
});
afterEach(() => mock.timers.reset());
after(() => rmSync(folder, { recursive: true, force: true }));
describe('power-on', () => {
    it('hands the firmware the sleep end plus five minutes', async () => {
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-28T22:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-on'));
        assert.deepEqual(updates, [{ left: { isOn: true, targetTemperatureF: 80, secondsRemaining: 8 * 3600 + 300 } }]);
    });
    it('measures from the moment the job actually runs', async () => {
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-28T22:02:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-on'));
        assert.deepEqual(updates, [{ left: { isOn: true, targetTemperatureF: 80, secondsRemaining: 8 * 3600 + 300 - 120 } }]);
    });
    it('never asks for more than twelve hours', () => {
        assert.equal(firmwareSeconds(at('2026-09-29T14:00:00Z'), at('2026-09-28T22:00:00Z')), 43200);
        assert.equal(firmwareSeconds(at('2026-09-28T22:00:01Z'), at('2026-09-28T22:00:00Z')), 301);
    });
    it('does not power on once the sleep has ended', async () => {
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-29T06:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-on'));
        assert.deepEqual(updates, []);
    });
    it('keeps a manual temperature while still setting the off time', async () => {
        settingsDB.data.left.scheduleOverrides.temperatureSchedules = { disabled: true, expiresAt: '2026-09-29T09:00:00+00:00' };
        await settingsDB.write();
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-28T22:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-on'));
        assert.deepEqual(updates, [{ left: { isOn: true, secondsRemaining: 8 * 3600 + 300 } }]);
    });
});
describe('temperature and power-off', () => {
    it('sets the rhythm temperature', async () => {
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-29T02:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'temperature'));
        assert.deepEqual(updates, [{ left: { targetTemperatureF: 72 } }]);
    });
    it('skips a temperature change while a manual change holds it', async () => {
        settingsDB.data.left.scheduleOverrides.temperatureSchedules = { disabled: true, expiresAt: '2026-09-29T09:00:00+00:00' };
        await settingsDB.write();
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-29T02:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'temperature'));
        assert.deepEqual(updates, []);
    });
    it('turns the side off at the end', async () => {
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-29T06:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-off'));
        assert.deepEqual(updates, [{ left: { isOn: false } }]);
    });
    it('sends every write as scheduled work that waits out a reconnect', async () => {
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-28T22:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-on'));
        setNow('2026-09-29T02:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'temperature'));
        setNow('2026-09-29T06:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-off'));
        assert.deepEqual(updateOptions, [{ background: true }, { background: true }, { background: true }]);
    });
    it('leaves on a sleep that started in the minute this one ends', async () => {
        const db = testRhythmsDB(schedulesDB.data, everyNight(testNight('06:00', '06:00')));
        const sleeps = resolveSleeps({ db, side: 'left', timeZone: 'UTC', from: at('2026-09-28T12:00:00Z'), to: at('2026-09-29T12:00:00Z') });
        const ending = sleeps.find(candidate => candidate.date === '2026-09-28');
        const starting = sleeps.find(candidate => candidate.date === '2026-09-29');
        assert.ok(ending && starting, 'two back-to-back sleeps');
        setNow('2026-09-29T06:00:00Z');
        await runRhythmEvent('left', starting, eventOf(starting, 'power-on'));
        await runRhythmEvent('left', ending, eventOf(ending, 'power-off'));
        assert.equal(updates.length, 1);
        assert.equal(updates[0].left.isOn, true);
    });
});
describe('alarm', () => {
    it('rings once per occurrence and records it', async (t) => {
        t.mock.method(globalThis, 'setTimeout', noTimers);
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-29T05:45:00Z');
        assert.equal(await runRhythmEvent('left', sleep, eventOf(sleep, 'alarm')), 20_000);
        assert.equal(await runRhythmEvent('left', sleep, eventOf(sleep, 'alarm')), 0);
        assert.equal(alarmCommands('ALARM_LEFT'), 1);
        assert.equal(hasAlarmOccurrence('left', 'rhythm:left:2026-09-28:05:45'), true);
    });
    it('skips an alarm that could only start more than three minutes late', async (t) => {
        t.mock.method(globalThis, 'setTimeout', noTimers);
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-29T05:49:00Z');
        assert.equal(await runRhythmEvent('left', sleep, eventOf(sleep, 'alarm')), 0);
        assert.equal(alarmCommands('ALARM_LEFT'), 0);
        assert.equal(hasAlarmOccurrence('left', 'rhythm:left:2026-09-28:05:45'), false);
    });
    it('skips the alarms of a sleep whose override expired inside it', async () => {
        settingsDB.data.left.scheduleOverrides.alarm = { disabled: false, timeOverride: '05:00', expiresAt: '2026-09-30T05:02:00+00:00' };
        await settingsDB.write();
        const sleep = sleepOn('2026-09-29');
        setNow('2026-09-30T05:45:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'alarm'));
        assert.deepEqual(commands, []);
    });
    it('rings when the override belongs to an earlier night', async (t) => {
        t.mock.method(globalThis, 'setTimeout', noTimers);
        settingsDB.data.left.scheduleOverrides.alarm = { disabled: true, timeOverride: '', expiresAt: '2026-09-30T07:00:00+00:00' };
        await settingsDB.write();
        const sleep = sleepOn('2026-09-30');
        setNow('2026-10-01T05:45:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'alarm'));
        assert.equal(alarmCommands('ALARM_LEFT'), 1);
    });
});
describe('pause', () => {
    it('leaves a paused side alone, power-off included', async () => {
        settingsDB.data.left.scheduleOverrides.pause = { active: true, expiresAt: '' };
        await settingsDB.write();
        const sleep = sleepOn('2026-09-28');
        for (const kind of ['power-on', 'temperature', 'alarm', 'power-off']) {
            await runRhythmEvent('left', sleep, eventOf(sleep, kind));
        }
        assert.deepEqual(updates, []);
        assert.deepEqual(commands, []);
    });
    it('silences an alarm due exactly at the end of a pause even when the job starts late', async () => {
        settingsDB.data.left.scheduleOverrides.pause = { active: true, expiresAt: '2026-09-29T05:45:00+00:00' };
        await settingsDB.write();
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-29T05:45:02Z');
        assert.equal(await runRhythmEvent('left', sleep, eventOf(sleep, 'alarm')), 0);
        assert.deepEqual(commands, []);
    });
    it('still turns the side off when the power-off is due exactly at the end of a pause', async () => {
        settingsDB.data.left.scheduleOverrides.pause = { active: true, expiresAt: '2026-09-29T06:00:00+00:00' };
        await settingsDB.write();
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-29T06:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-off'));
        assert.deepEqual(updates, [{ left: { isOn: false } }]);
    });
    it('judges a power-off held back by an alarm at the time it was due', async () => {
        settingsDB.data.left.scheduleOverrides.pause = { active: true, expiresAt: '2026-09-29T06:03:00+00:00' };
        await settingsDB.write();
        const sleep = sleepOn('2026-09-28');
        // A one-time alarm, which rings through a pause, held the power-off past the pause's end.
        setNow('2026-09-29T06:05:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-off'));
        assert.deepEqual(updates, []);
    });
    it('writes nothing for a paused side when the next sleep starts as this one ends', async () => {
        settingsDB.data.left.scheduleOverrides.pause = { active: true, expiresAt: '' };
        await settingsDB.write();
        const db = testRhythmsDB(schedulesDB.data, everyNight(testNight('06:00', '06:00')));
        const sleeps = resolveSleeps({ db, side: 'left', timeZone: 'UTC', from: at('2026-09-28T12:00:00Z'), to: at('2026-09-29T12:00:00Z') });
        const ending = sleeps.find(candidate => candidate.date === '2026-09-28');
        const starting = sleeps.find(candidate => candidate.date === '2026-09-29');
        assert.ok(ending && starting, 'two back-to-back sleeps');
        setNow('2026-09-29T06:00:00Z');
        await runRhythmEvent('left', starting, eventOf(starting, 'power-on'));
        await runRhythmEvent('left', ending, eventOf(ending, 'power-off'));
        assert.deepEqual(updates, []);
    });
});
describe('away mode', () => {
    it('drives the whole bed from the present side with one update', async () => {
        settingsDB.data.right.awayMode = true;
        await settingsDB.write();
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-28T22:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-on'));
        assert.deepEqual(updates, [{ left: { isOn: true, targetTemperatureF: 80, secondsRemaining: 8 * 3600 + 300 } }]);
    });
    it('rings an alarm only on the present side', async (t) => {
        t.mock.method(globalThis, 'setTimeout', noTimers);
        settingsDB.data.right.awayMode = true;
        await settingsDB.write();
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-29T05:45:00Z');
        assert.equal(await runRhythmEvent('left', sleep, eventOf(sleep, 'alarm')), 20_000);
        assert.equal(alarmCommands('ALARM_LEFT'), 1);
        assert.equal(alarmCommands('ALARM_RIGHT'), 0);
    });
    it("ignores the away side's own rhythm", async () => {
        settingsDB.data.left.awayMode = true;
        await settingsDB.write();
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-28T22:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-on'));
        await runSleepAnalysis('left', sleep);
        assert.deepEqual(updates, []);
        assert.deepEqual(analyses, []);
    });
});
describe('moving the off time of a sleep in progress', () => {
    const later = () => ({ ...sleepOn('2026-09-28'), end: at('2026-09-29T09:00:00Z') });
    beforeEach(() => setEngineActivation({ active: true, db: testRhythmsDB(schedulesDB.data, everyNight(null)) }));
    afterEach(() => setEngineActivation({ active: false, reason: 'flag-off' }));
    it('sends the new end plus five minutes as scheduled work', async () => {
        setNow('2026-09-28T23:00:00Z');
        await rearmRhythmSleep('left', later());
        assert.deepEqual(updates, [{ left: { secondsRemaining: 10 * 3600 + 300 } }]);
        assert.deepEqual(updateOptions, [{ background: true }]);
    });
    it('sends nothing when the power-on already sent that end', async () => {
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-28T22:00:00Z');
        await runRhythmEvent('left', sleep, eventOf(sleep, 'power-on'));
        updates.length = 0;
        await rearmRhythmSleep('left', sleep);
        assert.deepEqual(updates, []);
    });
    it('never turns on a side that is off', async () => {
        deviceStatus.left.isOn = false;
        setNow('2026-09-28T23:00:00Z');
        await rearmRhythmSleep('left', later());
        assert.deepEqual(updates, []);
    });
    it('waits for the next plan when the Pod does not reconnect in time', async () => {
        pod.connected = false;
        setNow('2026-09-28T23:00:00Z');
        await rearmRhythmSleep('left', later());
        assert.deepEqual(updates, []);
        pod.connected = true;
        await rearmRhythmSleep('left', later());
        assert.equal(updates.length, 1);
    });
    it('sends nothing when Rhythms was turned off while it waited for the Pod', async () => {
        pod.onConnect = () => setEngineActivation({ active: false, reason: 'flag-off' });
        setNow('2026-09-28T23:00:00Z');
        await rearmRhythmSleep('left', later());
        assert.deepEqual(updates, []);
    });
    it('leaves a paused or away side alone', async () => {
        setNow('2026-09-28T23:00:00Z');
        settingsDB.data.left.scheduleOverrides.pause = { active: true, expiresAt: '2026-09-29T10:00:00+00:00' };
        await settingsDB.write();
        await rearmRhythmSleep('left', later());
        settingsDB.data.left.scheduleOverrides.pause = { active: false, expiresAt: '' };
        settingsDB.data.left.awayMode = true;
        await settingsDB.write();
        await rearmRhythmSleep('left', later());
        assert.deepEqual(updates, []);
    });
});
describe('end-of-sleep analysis', () => {
    it('analyses the sleep with an hour either side', async () => {
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-29T06:15:00Z');
        await runSleepAnalysis('left', sleep);
        assert.deepEqual(analyses, [['left', '2026-09-28T21:00:00.000Z', '2026-09-29T07:00:00.000Z']]);
    });
    it('re-analyses two hours after the end over the 25 hours before that', async () => {
        const sleep = sleepOn('2026-09-28');
        setNow('2026-09-29T08:00:00Z');
        await runSleepAnalysis('left', sleep, REANALYSIS_DELAY_MS, ANALYSIS_MAX_WINDOW_MS);
        assert.deepEqual(analyses, [['left', '2026-09-28T07:00:00.000Z', '2026-09-29T08:00:00.000Z']]);
    });
    it('skips analysis without biometrics', async () => {
        servicesDB.data.biometrics.enabled = false;
        await servicesDB.write();
        await runSleepAnalysis('left', sleepOn('2026-09-28'));
        assert.deepEqual(analyses, []);
    });
});
//# sourceMappingURL=runEvent.test.js.map