import assert from 'node:assert/strict';
import { describe, it, before, beforeEach, mock } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, appendFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import cbor from 'cbor';

import type { DeviceStatus } from '../routes/deviceStatus/deviceStatusSchema.js';

// One outer RAW record. The cbor library writes the keys in this order, which
// is the framing readRawRecord expects.
const frameRecord = (seq: number, data: Buffer): Buffer => cbor.encode({ seq, data });

// Same isolated DATA_FOLDER pattern as frankenMonitor.test.ts, plus a RAW
// directory of this test's own.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-buttons-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
const rawDir = mkdtempSync(path.join(tmpdir(), 'free-sleep-raw-'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
process.env.POD_RAW_DIR = rawDir;

let updates: Array<Partial<DeviceStatus>> = [];
let updateRejectsWith: Error | null = null;
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: {
    updateDeviceStatus: async (status: Partial<DeviceStatus>) => {
      updates.push(status);
      if (updateRejectsWith) throw updateRejectsWith;
    },
  },
});

let manualChanges: string[] = [];
mock.module(new URL('../jobs/scheduleOverride.js', import.meta.url).href, {
  namedExports: {
    markManualTempChange: async (side: string) => { manualChanges.push(side); },
  },
});

let alarmTaps: Array<{ side: string; behavior: string }> = [];
mock.module(new URL('./tapAlarm.js', import.meta.url).href, {
  namedExports: {
    handleAlarmTap: async (side: string, tap: { behavior: string }) => { alarmTaps.push({ side, behavior: tap.behavior }); },
  },
});

let readTarget = 82;
mock.module(new URL('./frankenServer.js', import.meta.url).href, {
  namedExports: {
    getDeviceStatusCoalesced: async () => ({
      left: { targetTemperatureF: readTarget },
      right: { targetTemperatureF: readTarget },
    }),
    connectFranken: async () => ({}),
    FrankenCommandTimeoutError: class extends Error {},
  },
});

let ButtonMonitor: typeof import('./buttonMonitor.js')['ButtonMonitor'];
let settingsDB: typeof import('../db/settings.js')['default'];
let serverStatus: typeof import('../serverStatus.js')['default'];
let activeAlarms: typeof import('../jobs/activeAlarms.js')['activeAlarms'];
let setSnooze: typeof import('../jobs/activeAlarms.js')['setSnooze'];
let cancelSnooze: typeof import('../jobs/activeAlarms.js')['cancelSnooze'];

before(async () => {
  ({ ButtonMonitor } = await import('./buttonMonitor.js'));
  ({ default: settingsDB } = await import('../db/settings.js'));
  ({ default: serverStatus } = await import('../serverStatus.js'));
  ({ activeAlarms, setSnooze, cancelSnooze } = await import('../jobs/activeAlarms.js'));
});

const logRecord = (msg: string, seq = 1, ts = Date.now() / 1000): Buffer =>
  frameRecord(seq, cbor.encode({ type: 'log', ts, level: 'info', msg, seq }));

function click(sideTag: 'R' | 'L', code: number, seq = 1): Buffer {
  return Buffer.concat([
    logRecord(`[tca8418${sideTag}] gpi press ${code}`, seq),
    logRecord(`[tca8418${sideTag}] gpi release ${code}`, seq),
  ]);
}

// The firmware batches several log records into one chunk (about 1.6 KB seen
// live), most of them unrelated lines.
function batchedClick(sideTag: 'R' | 'L', code: number, seq = 1): Buffer {
  const filler = 'x'.repeat(120);
  const now = Date.now() / 1000;
  return frameRecord(seq, Buffer.concat([
    cbor.encode({ type: 'log', ts: now, level: 'debug', msg: `AsioTcpClient.h:63 tryConnect|[asiotcp] ${filler}` }),
    cbor.encode({
      type: 'log', ts: now, level: 'debug', msg: `Sensor.cpp:608 handleCommand|[sensor] -> FW: 1 [tca8418${sideTag}] gpi press ${code}`,
    }),
    cbor.encode({
      type: 'log', ts: now, level: 'debug', msg: `Sensor.cpp:608 handleCommand|[sensor] -> FW: 2 [tca8418${sideTag}] gpi release ${code}`,
    }),
    ...Array.from({ length: 8 }, (_, index) =>
      cbor.encode({ type: 'log', ts: now, level: 'debug', msg: `Thermostat.cpp:99 tick|[therm] ${filler} ${index}` })),
  ]));
}

// Drives the private poll directly instead of waiting on the interval.
type Internals = { poll(): Promise<void> };

function writeRaw(name: string, buffer: Buffer, mtimeSec: number): string {
  const full = path.join(rawDir, name);
  writeFileSync(full, buffer);
  utimesSync(full, mtimeSec, mtimeSec);
  return full;
}

function appendRaw(full: string, buffer: Buffer, mtimeSec: number): void {
  appendFileSync(full, buffer);
  utimesSync(full, mtimeSec, mtimeSec);
}

const leftTargets = () => updates.map(update => update.left?.targetTemperatureF).filter(target => target !== undefined);
const rightTargets = () => updates.map(update => update.right?.targetTemperatureF).filter(target => target !== undefined);

describe('ButtonMonitor', () => {
  let monitor: Internals;

  beforeEach(async () => {
    updates = []; manualChanges = []; alarmTaps = [];
    updateRejectsWith = null;
    readTarget = 82;
    for (const file of readdirSync(rawDir)) rmSync(path.join(rawDir, file));
    activeAlarms.clear();
    cancelSnooze('left');
    cancelSnooze('right');

    await settingsDB.read();
    for (const side of ['left', 'right'] as const) {
      settingsDB.data[side].buttons = { invertButtons: false, stepF: 1, favoriteTemperatureF: 78 };
    }
    settingsDB.data.features.coverButtons = true;
    await settingsDB.write();

    monitor = new ButtonMonitor() as unknown as Internals;
    // The first poll reads nothing: it only finds where the newest file ends.
    await monitor.poll();
  });

  it('steps the right side up by stepF on a top click', async () => {
    writeRaw('001.RAW', click('R', 97), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(rightTargets(), [83]);
    assert.deepEqual(manualChanges, ['right']);
  });

  it('steps the left side down on a bottom click', async () => {
    writeRaw('001.RAW', click('L', 99), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(leftTargets(), [81]);
  });

  it('finds a click inside a batched chunk of unrelated log lines', async () => {
    const chunk = batchedClick('R', 97);
    assert.ok(chunk.length > 512);
    writeRaw('001.RAW', chunk, Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(rightTargets(), [83]);
  });

  it('stacks quick presses instead of stepping each from the same read', async () => {
    // The read target stays at 82 the whole time, as it does live.
    writeRaw('001.RAW', Buffer.concat([click('R', 97, 1), click('R', 97, 2), click('R', 97, 3)]), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(rightTargets(), [83, 84, 85]);
  });

  it('keeps the target within 55 to 110 F', async () => {
    readTarget = 110;
    writeRaw('001.RAW', click('R', 97), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(rightTargets(), [110]);
  });

  it('swaps the top and bottom buttons with invertButtons', async () => {
    settingsDB.data.right.buttons.invertButtons = true;
    await settingsDB.write();
    writeRaw('001.RAW', click('R', 97), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(rightTargets(), [81]);
  });

  it('steps by the side\'s stepF', async () => {
    settingsDB.data.right.buttons.stepF = 3;
    await settingsDB.write();
    writeRaw('001.RAW', click('R', 97), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(rightTargets(), [85]);
  });

  it('stops a ringing alarm with the logo button', async () => {
    activeAlarms.set('right', { vibrationIntensity: 100, duration: 60, vibrationPattern: 'double' });
    writeRaw('001.RAW', click('R', 98), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(alarmTaps, [{ side: 'right', behavior: 'dismiss' }]);
    assert.deepEqual(updates, []);
  });

  it('stops a snoozed alarm with the logo button', async () => {
    setSnooze('left', 60_000, () => {});
    writeRaw('001.RAW', click('L', 98), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(alarmTaps, [{ side: 'left', behavior: 'dismiss' }]);
    assert.deepEqual(updates, []);
  });

  it('sets the side to its favorite temperature and on with the logo button', async () => {
    writeRaw('001.RAW', click('L', 98), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(updates, [{ left: { isOn: true, targetTemperatureF: 78 } }]);
    assert.deepEqual(manualChanges, ['left']);
  });

  it('leaves a hold to the firmware', async () => {
    writeRaw('001.RAW', Buffer.concat([
      logRecord('[tca8418R] gpi press 97', 1),
      logRecord('[buttons] long press top: 500ms', 1),
      logRecord('[tca8418R] gpi release 97', 1),
    ]), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(updates, []);
  });

  it('does nothing while coverButtons is off, and says so', async () => {
    settingsDB.data.features.coverButtons = false;
    await settingsDB.write();
    writeRaw('001.RAW', click('R', 97), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(updates, []);
    assert.equal(serverStatus.status.buttonMonitor.status, 'healthy');
    assert.match(serverStatus.status.buttonMonitor.message, /Off in Settings/);
  });

  it('reports a missing or stale RAW file and recovers on fresh data', async () => {
    assert.equal(serverStatus.status.buttonMonitor.status, 'failed');
    assert.match(serverStatus.status.buttonMonitor.message, /No RAW files/);
    const payload = frameRecord(1, cbor.encode({ type: 'frzHealth', ts: Date.now() / 1000 }));
    const full = writeRaw('001.RAW', payload, Date.now() / 1000 - 30);
    await monitor.poll();
    assert.equal(serverStatus.status.buttonMonitor.status, 'failed');
    assert.match(serverStatus.status.buttonMonitor.message, /not being written/);
    appendRaw(full, payload, Date.now() / 1000);
    await monitor.poll();
    assert.equal(serverStatus.status.buttonMonitor.status, 'healthy');
  });

  it('does not replay presses already in the file when it starts', async () => {
    const full = writeRaw('001.RAW', click('R', 97), Date.now() / 1000);
    const restarted = new ButtonMonitor() as unknown as Internals;
    await restarted.poll();
    assert.deepEqual(updates, []);

    appendRaw(full, click('R', 99, 2), Date.now() / 1000);
    await restarted.poll();
    assert.deepEqual(rightTargets(), [81]);
  });

  it('ignores a press older than 30 seconds', async () => {
    writeRaw('001.RAW', Buffer.concat([
      logRecord('[tca8418R] gpi press 97', 1, Date.now() / 1000 - 60),
      logRecord('[tca8418R] gpi release 97', 1, Date.now() / 1000 - 60),
    ]), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(updates, []);
  });

  it('reads only what was appended since the last poll', async () => {
    const full = writeRaw('001.RAW', click('R', 97, 1), Date.now() / 1000);
    await monitor.poll();
    assert.deepEqual(rightTargets(), [83]);

    appendRaw(full, click('R', 99, 2), Date.now() / 1000);
    await monitor.poll();
    assert.deepEqual(rightTargets(), [83, 82]);
  });

  it('follows the firmware to a new file and reads it from the start', async () => {
    writeRaw('001.RAW', click('R', 97, 1), Date.now() / 1000 - 5);
    await monitor.poll();
    assert.deepEqual(rightTargets(), [83]);

    writeRaw('002.RAW', click('L', 99, 1), Date.now() / 1000);
    await monitor.poll();
    assert.deepEqual(leftTargets(), [81]);
  });

  it('never tails SEQNO.RAW', async () => {
    writeRaw('001.RAW', click('R', 97, 1), Date.now() / 1000);
    writeRaw('SEQNO.RAW', Buffer.from([1, 2, 3, 4]), Date.now() / 1000 + 5);
    await monitor.poll();

    assert.deepEqual(rightTargets(), [83]);
  });

  it('resyncs past a stray byte and reads the records after it', async () => {
    writeRaw('001.RAW', Buffer.concat([Buffer.from([0x55, 0x55]), click('R', 97)]), Date.now() / 1000);
    await monitor.poll();

    assert.deepEqual(rightTargets(), [83]);
  });

  it('reads a record cut off at the end of one poll once the rest arrives', async () => {
    const whole = click('R', 97);
    const full = writeRaw('001.RAW', whole.subarray(0, whole.length - 7), Date.now() / 1000);
    await monitor.poll();
    assert.deepEqual(updates, []);

    appendRaw(full, whole.subarray(whole.length - 7), Date.now() / 1000);
    await monitor.poll();
    assert.deepEqual(rightTargets(), [83]);
  });

  it('reports a press that could not be applied and keeps going', async () => {
    updateRejectsWith = new Error('franken write failed');
    const full = writeRaw('001.RAW', click('R', 97, 1), Date.now() / 1000);
    await monitor.poll();
    assert.equal(updates.length, 1);
    assert.equal(serverStatus.status.buttonMonitor.status, 'failed');
    assert.match(serverStatus.status.buttonMonitor.message, /franken write failed/);

    updateRejectsWith = null;
    appendRaw(full, click('R', 97, 2), Date.now() / 1000);
    await monitor.poll();
    assert.equal(updates.length, 2);
    assert.equal(serverStatus.status.buttonMonitor.status, 'healthy');
  });
});
