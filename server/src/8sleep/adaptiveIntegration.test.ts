import assert from 'node:assert/strict';
import { test, mock, beforeEach } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = mkdtempSync(path.join(tmpdir(), 'adaptive-integration-'));
mkdirSync(path.join(directory, 'lowdb'));
process.env.DATA_FOLDER = `${directory}/`;
process.env.ENV = 'local';
let temperature = 72;
let readBarrier: Promise<void> | null = null;
const commands: string[] = [];
mock.module('./frankenServer.js', { namedExports: {
  getDeviceStatusCoalesced: async () => {
    if (readBarrier) await readBarrier;
    return { left: { targetTemperatureF: temperature, isOn: true, isAlarmVibrating: false },
      right: { targetTemperatureF: 74, isOn: true, isAlarmVibrating: false }, waterLevel: 'true', isPriming: false };
  },
} });
mock.module('./deviceApi.js', { namedExports: {
  executeFunction: async (command: string, arg: string) => {
    commands.push(command);
    if (command === 'TEMP_LEVEL_LEFT') temperature = Math.round(82.5 + Number(arg) * 0.275);
  },
} });
mock.module('../db/collector.js', { namedExports: { recordEvent: () => {} } });
const { adaptiveStore, AdaptiveStore } = await import('./adaptiveState.js');
const { updateDeviceStatus } = await import('../routes/deviceStatus/updateDeviceStatus.js');
const { thermalQueue } = await import('./thermalQueue.js');

beforeEach(() => {
  temperature = 72; commands.length = 0; readBarrier = null;
  adaptiveStore.fault = null; adaptiveStore.data.events = [];
  for (const side of ['left', 'right'] as const) {
    adaptiveStore.data[side] = { mode: 'active', minimumF: 68, maximumF: 78, holdUntil: 0, expectedF: null, ready: false,
      session: { start: Date.now() - 2 * 3600000, end: Date.now() + 8 * 3600000, baselineF: 72, lastAutomaticAt: null } };
  }
});

test('physical and app changes are independently attributed and survive restart', async () => {
  await updateDeviceStatus({ left: { targetTemperatureF: 73 } }, 'physical-button');
  assert.equal(adaptiveStore.data.events[0].source, 'physical-button');
  assert.equal(adaptiveStore.data.events[0].confirmed, true);
  assert.ok(adaptiveStore.data.left.holdUntil > Date.now());
  assert.equal(adaptiveStore.data.right.holdUntil, 0);
  await updateDeviceStatus({ left: { targetTemperatureF: 74 } }, 'app');
  const restored = new AdaptiveStore(path.join(directory, 'adaptive-temperature.json'));
  assert.equal(restored.data.events[1].source, 'app');
  assert.equal(restored.data.left.holdUntil, adaptiveStore.data.left.holdUntil);
});

test('manual intent arriving during an automatic read cancels its write before dispatch', async () => {
  let release: () => void = () => {};
  readBarrier = new Promise<void>(resolve => { release = resolve; });
  const revision = adaptiveStore.revision.left;
  const automatic = updateDeviceStatus({ left: { targetTemperatureF: 71 } }, 'automatic',
    () => adaptiveStore.revision.left === revision);
  const rejected = assert.rejects(automatic, /cancelled/);
  await new Promise(resolve => setImmediate(resolve));
  const manual = updateDeviceStatus({ left: { targetTemperatureF: 73 } }, 'physical-button');
  release(); readBarrier = null;
  await rejected; await manual;
  assert.equal(temperature, 73);
  assert.deepEqual(commands, ['TEMP_LEVEL_LEFT']);
});

test('power-off intent also cancels a queued automatic write', async () => {
  let release: () => void = () => {};
  const blocking = thermalQueue.run(() => new Promise<void>(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const revision = adaptiveStore.revision.left;
  const automatic = updateDeviceStatus({ left: { targetTemperatureF: 71 } }, 'automatic',
    () => adaptiveStore.revision.left === revision);
  const rejected = assert.rejects(automatic, /cancelled/);
  const off = updateDeviceStatus({ left: { isOn: false } }, 'app');
  release(); await blocking; await rejected; await off;
  assert.deepEqual(commands, ['LEFT_TEMP_DURATION']);
});

test('automatic writes are recorded as automatic and failed queues do not block manual control', async () => {
  await updateDeviceStatus({ left: { targetTemperatureF: 71 } }, 'automatic', () => true);
  assert.equal(adaptiveStore.data.events[0].source, 'automatic');
  assert.equal(adaptiveStore.data.left.holdUntil, 0);
  await assert.rejects(updateDeviceStatus({ left: { targetTemperatureF: 999 } }, 'app'));
  await updateDeviceStatus({ left: { targetTemperatureF: 72 } }, 'app');
  assert.equal(temperature, 72);
});

test('corrupt or unwritable state fails closed without erasing saved data', () => {
  const corrupt = path.join(directory, 'corrupt.json');
  writeFileSync(corrupt, '{broken');
  const restored = new AdaptiveStore(corrupt);
  assert.ok(restored.fault);
  const badPath = new AdaptiveStore(path.join(corrupt, 'cannot-write.json'));
  badPath.save();
  assert.ok(badPath.fault);
});
