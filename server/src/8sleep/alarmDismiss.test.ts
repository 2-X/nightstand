import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import cbor from 'cbor';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-alarm-dismiss-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const calls: Array<[string, string]> = [];
let onConnect = () => {};
const franken = {
  callFunction: async (command: string, arg: string) => { calls.push([command, arg]); },
  getDeviceStatus: async () => ({ left: { isOn: true }, right: { isOn: true }, hubVersion: 'Pod 5' }),
};
mock.module('./frankenServer.js', { namedExports: { connectFrankenWithin: async () => { onConnect(); return franken; } } });
const { executeAlarm } = await import('../jobs/alarmScheduler.js');
const { updateDeviceStatus } = await import('../routes/deviceStatus/updateDeviceStatus.js');
const { default: memoryDB } = await import('../db/memoryDB.js');
const alarm = { side: 'left', vibrationIntensity: 50, duration: 1, vibrationPattern: 'double', force: true } as const;

beforeEach(() => { calls.length = 0; onConnect = () => {}; });
after(() => rmSync(folder, { recursive: true, force: true }));

for (const side of ['left', 'right'] as const) {
  test(`dismiss replaces the ${side} alarm for one second before clearing it`, async t => {
    const now = 1_800_000_000_000;
    t.mock.timers.enable({ apis: ['Date'], now });
    memoryDB.data[side].isAlarmVibrating = true;
    await memoryDB.write();
    await updateDeviceStatus({ [side]: { isAlarmVibrating: false } });
    assert.deepEqual(calls.map(([command]) => command), [side === 'left' ? 'ALARM_LEFT' : 'ALARM_RIGHT', 'ALARM_CLEAR']);
    assert.deepEqual(cbor.decodeFirstSync(Buffer.from(calls[0][1], 'hex')), {
      pl: 1, du: 1, pi: 'double', tt: 1_800_000_000,
    });
    assert.equal(calls[1][1], 'empty');
    assert.equal(memoryDB.data[side].isAlarmVibrating, false);
  });
}

test('dismiss uses the time the replacement is sent after waiting for a connection', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  onConnect = () => t.mock.timers.tick(5_000);
  await updateDeviceStatus({ left: { isAlarmVibrating: false } });
  assert.equal(cbor.decodeFirstSync(Buffer.from(calls[0][1], 'hex')).tt, 1_800_000_005);
});

test('normal alarms retain their ten second minimum', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(await executeAlarm(alarm), 10_000);
  assert.equal(cbor.decodeFirstSync(Buffer.from(calls[0][1], 'hex')).du, 10);
  t.mock.timers.tick(9_999);
  assert.equal(memoryDB.data.left.isAlarmVibrating, true);
});

test('dismiss invalidates the old timer before a later alarm rings', async t => {
  const timers: Array<() => Promise<void>> = [];
  t.mock.method(globalThis, 'setTimeout', ((callback: () => Promise<void>) => {
    timers.push(callback);
    return {} as NodeJS.Timeout;
  }) as unknown as typeof setTimeout);
  await executeAlarm(alarm);
  await updateDeviceStatus({ left: { isAlarmVibrating: false } });
  const read = t.mock.method(memoryDB, 'read');
  await timers[0]();
  assert.equal(read.mock.callCount(), 0, 'the dismissed timer must not enter memory updates');
  await executeAlarm(alarm);
  await timers[0]();
  assert.equal(memoryDB.data.left.isAlarmVibrating, true);
  await timers[1]();
  assert.equal(memoryDB.data.left.isAlarmVibrating, false);
});

test('dismissing one side leaves the other ringing side to its own timer', async t => {
  const timers: Array<() => Promise<void>> = [];
  t.mock.method(globalThis, 'setTimeout', ((callback: () => Promise<void>) => {
    timers.push(callback);
    return {} as NodeJS.Timeout;
  }) as unknown as typeof setTimeout);
  await executeAlarm(alarm);
  await executeAlarm({ ...alarm, side: 'right' });
  assert.equal(memoryDB.data.left.isAlarmVibrating, true);
  assert.equal(memoryDB.data.right.isAlarmVibrating, true);
  await updateDeviceStatus({ left: { isAlarmVibrating: false } });
  assert.equal(memoryDB.data.left.isAlarmVibrating, false);
  assert.equal(memoryDB.data.right.isAlarmVibrating, true);
  await timers[0]();
  assert.equal(memoryDB.data.right.isAlarmVibrating, true, 'the dismissed side timer must not touch the other side');
  await timers[1]();
  assert.equal(memoryDB.data.right.isAlarmVibrating, false);
});

test('a ringing alarm keeps the settings it started with', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { activeAlarms } = await import('../jobs/activeAlarms.js');
  await executeAlarm({ ...alarm, vibrationIntensity: 30, vibrationPattern: 'rise', duration: 45 });
  assert.deepEqual(activeAlarms.get('left'), { vibrationIntensity: 30, vibrationPattern: 'rise', duration: 45 });
});

test('an alarm that starts replaces a snooze waiting on its side only', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { cancelSnooze, hasSnooze, setSnooze } = await import('../jobs/activeAlarms.js');
  t.after(() => { cancelSnooze('left'); cancelSnooze('right'); });
  setSnooze('left', 300_000, () => {});
  setSnooze('right', 300_000, () => {});
  await executeAlarm(alarm);
  assert.equal(hasSnooze('left'), false);
  assert.equal(hasSnooze('right'), true);
});

test('an alarm that does not start leaves the snooze in place', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { cancelSnooze, hasSnooze, setSnooze } = await import('../jobs/activeAlarms.js');
  t.after(() => cancelSnooze('left'));
  t.mock.method(franken, 'getDeviceStatus', async () => ({ left: { isOn: false }, right: { isOn: false }, hubVersion: 'Pod 5' }));
  setSnooze('left', 300_000, () => {});
  assert.equal(await executeAlarm({ ...alarm, force: false }), 0);
  assert.equal(hasSnooze('left'), true);
});
