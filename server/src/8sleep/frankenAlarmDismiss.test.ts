import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Socket } from 'node:net';
import cbor from 'cbor';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-franken-dismiss-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const { Franken } = await import('./frankenServer.js');
const { activeAlarms, forgetActiveAlarm, hasSnooze, setSnooze } = await import('../jobs/activeAlarms.js');
const { default: memoryDB } = await import('../db/memoryDB.js');
const reply = (value: number) => Object.entries({
  tgHeatLevelL: '0', tgHeatLevelR: '0', heatTimeL: '3600', heatTimeR: '3600',
  heatLevelL: '0', heatLevelR: '0', sensorLabel: '20500-0001-J01-0000',
  waterLevel: 'true', priming: 'false', settings: cbor.encode({ gl: 20, gr: 20, lb: 50 }).toString('hex'),
  dismissAlarm: `{"l":${value},"r":0}`,
}).map(([key, value]) => `${key} = ${value}`).join('\n');

beforeEach(async () => {
  forgetActiveAlarm('left');
  activeAlarms.set('left', { vibrationIntensity: 40, duration: 120, vibrationPattern: 'double' });
  memoryDB.data.left.isAlarmVibrating = true;
  await memoryDB.write();
});
after(() => {
  forgetActiveAlarm('left');
  rmSync(folder, { recursive: true, force: true });
});

test('a reconnect takes a new baseline for an alarm that is still ringing', async t => {
  const old = Franken.fromSocket(new Socket());
  t.after(() => old.close());
  t.mock.method(old, 'sendMessage', async () => reply(100));
  await old.getDeviceStatus();
  old.close();
  const fresh = Franken.fromSocket(new Socket());
  t.after(() => fresh.close());
  let value = 200;
  t.mock.method(fresh, 'sendMessage', async () => reply(value));
  const baseline = await fresh.getDeviceStatus();
  assert.equal(activeAlarms.has('left'), true);
  assert.equal(baseline.left.isAlarmVibrating, true);
  value = 201;
  const dismissed = await fresh.getDeviceStatus();
  assert.equal(activeAlarms.has('left'), false);
  assert.equal(dismissed.left.isAlarmVibrating, false);
});

test('a reconnect preserves the active alarm counter through reset and restoration', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const alarm = activeAlarms.get('left');
  setSnooze('left', 300_000, () => {});
  const old = Franken.fromSocket(new Socket());
  t.after(() => old.close());
  t.mock.method(old, 'sendMessage', async () => reply(100));
  await old.getDeviceStatus();
  old.close();
  const fresh = Franken.fromSocket(new Socket());
  t.after(() => fresh.close());
  let value = 0;
  t.mock.method(fresh, 'sendMessage', async () => reply(value));
  for (const restored of [0, 100]) {
    value = restored;
    const status = await fresh.getDeviceStatus();
    assert.equal(activeAlarms.get('left'), alarm);
    assert.equal(status.left.isAlarmVibrating, true);
    assert.equal(hasSnooze('left'), true);
  }
  value = 101;
  const dismissed = await fresh.getDeviceStatus();
  assert.equal(activeAlarms.has('left'), false);
  assert.equal(dismissed.left.isAlarmVibrating, false);
  assert.equal(hasSnooze('left'), false);
});

for (const ending of ['close', 'socket close'] as const) {
  test(`a ${ending} cancels a dismissal waiting on the memory read`, async t => {
    const socket = new Socket();
    const connection = Franken.fromSocket(socket);
    t.after(() => connection.close());
    let value = 100;
    t.mock.method(connection, 'sendMessage', async () => reply(value));
    await connection.getDeviceStatus();
    const read = memoryDB.read.bind(memoryDB);
    let release!: () => void;
    let entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    t.mock.method(memoryDB, 'read', async () => {
      entered();
      await new Promise<void>(resolve => { release = resolve; });
      await read();
    });
    value = 101;
    const pending = connection.getDeviceStatus();
    await reading;
    if (ending === 'close') connection.close();
    else socket.emit('close', false);
    t.mock.restoreAll();
    release();
    await pending;
    assert.equal(activeAlarms.has('left'), true);
    assert.equal(memoryDB.data.left.isAlarmVibrating, true);
  });
}
