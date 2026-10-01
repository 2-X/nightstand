import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import schedule from 'node-schedule';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-smart-off-runtime-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const updates: Array<{ update: unknown; options: unknown }> = [];
mock.module(new URL('../../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: { updateDeviceStatus: async (update: unknown, options?: unknown) => { updates.push({ update, options }); } },
});
mock.module(new URL('../../8sleep/deviceApi.js', import.meta.url).href, {
  namedExports: { executeFunction: async () => {} },
});
const pod = { connected: true, fails: false, status: { left: { isOn: true }, right: { isOn: false } } };
mock.module(new URL('../../8sleep/frankenServer.js', import.meta.url).href, {
  namedExports: {
    connectFrankenWithin: async () => ({ getDeviceStatus: async () => pod.status }),
    isFrankenConnected: () => pod.connected,
    getDeviceStatusCoalesced: async () => {
      if (pod.fails) throw new Error('Pod hardware is not connected');
      return pod.status;
    },
  },
});

const { default: settingsDB } = await import('../../db/settings.js');
const { smartOffRuntime } = await import('./smartOffRuntime.js');
const { holdForHandBack, resetOffTimes } = await import('./runEvent.js');

beforeEach(async () => {
  updates.length = 0;
  pod.connected = true;
  pod.fails = false;
  resetOffTimes();
  await settingsDB.read();
  settingsDB.data.left.scheduleOverrides.alarm = { disabled: false, timeOverride: '', expiresAt: '' };
});
afterEach(() => {
  for (const name of Object.keys(schedule.scheduledJobs)) schedule.cancelJob(name);
});
after(() => rmSync(folder, { recursive: true, force: true }));

describe('smartOffRuntime', () => {
  it('reads a side as on or off, and as unread when the Pod cannot be read now', async () => {
    const off = smartOffRuntime();
    assert.equal(await off.sideIsOn('left'), true);
    assert.equal(await off.sideIsOn('right'), false);
    pod.connected = false;
    assert.equal(await off.sideIsOn('left'), null);
    pod.connected = true;
    pod.fails = true;
    assert.equal(await off.sideIsOn('left'), null);
  });

  it('turns a side off as scheduled work, and not while handing back before a stop', () => {
    const off = smartOffRuntime();
    off.powerOff('left');
    assert.deepEqual(updates, [{ update: { left: { isOn: false } }, options: { background: true } }]);
    holdForHandBack(new Date());
    off.powerOff('left');
    assert.equal(updates.length, 1);
  });

  const nightOn = (date: string) => ({ date, start: new Date(Date.now() - 8 * 3600_000), end: new Date(Date.now() + 60 * 60_000) });

  it("checks the night's alarm jobs", () => {
    schedule.scheduleJob('rhythm-left-2026-09-28-alarm-0545-0', new Date(Date.now() + 20 * 60_000), () => {});
    const off = smartOffRuntime();
    assert.equal(off.alarmPending('left', nightOn('2026-09-28'), new Date(Date.now() + 30 * 60_000)), true);
    assert.equal(off.alarmPending('left', nightOn('2026-09-29'), new Date(Date.now() + 30 * 60_000)), false);
  });

  it("leaves out the night's own alarm while Skip alarm skips it, and still counts the replacement time", () => {
    const night = nightOn('2026-09-28');
    const until = new Date(Date.now() + 30 * 60_000);
    schedule.scheduleJob('rhythm-left-2026-09-28-alarm-0545-0', new Date(Date.now() + 20 * 60_000), () => {});
    settingsDB.data.left.scheduleOverrides.alarm = { disabled: true, timeOverride: '', expiresAt: night.end.toISOString() };
    assert.equal(smartOffRuntime().alarmPending('left', night, until), false);
    // The override's replacement time is its own job, and it rings.
    schedule.scheduleJob('left-alarm-override-05:55', new Date(Date.now() + 25 * 60_000), () => {});
    assert.equal(smartOffRuntime().alarmPending('left', night, until), true);
  });

  it('reads the daily restart from the settings', async () => {
    await settingsDB.read();
    settingsDB.data.timeZone = 'UTC';
    settingsDB.data.primePodDaily = { enabled: true, time: '14:30' };
    settingsDB.data.rebootDaily = true;
    assert.equal(smartOffRuntime().nextRestart(new Date('2026-09-29T06:00:00Z'))?.toISOString(), '2026-09-29T13:30:00.000Z');
    settingsDB.data.rebootDaily = false;
    assert.equal(smartOffRuntime().nextRestart(new Date('2026-09-29T06:00:00Z')), null);
  });
});
