import assert from 'node:assert/strict';
import { describe, it, before, beforeEach, mock } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, appendFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import cbor from 'cbor';

// Isolated temp DATA_FOLDER + a temp RAW dir, same pattern as the other
// server tests.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-btn-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
const rawDir = mkdtempSync(path.join(tmpdir(), 'free-sleep-raw-'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
process.env.POD_RAW_DIR = rawDir;

// --- Mocks for the dispatch dependencies ----------------------------------
let tempCalls: Array<{ side: string; current: number; delta: number }> = [];
mock.module(new URL('./applyTemperatureChange.js', import.meta.url).href, {
  namedExports: {
    applyTemperatureDelta: async (side: string, current: number, delta: number) => {
      tempCalls.push({ side, current, delta });
      return current + delta;
    },
  },
});

let updateCalls: any[] = [];
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: {
    updateDeviceStatus: async (status: any) => { updateCalls.push(status); },
  },
});

let execCalls: Array<{ command: string; arg: string }> = [];
mock.module(new URL('./deviceApi.js', import.meta.url).href, {
  namedExports: {
    executeFunction: async (command: string, arg = 'empty') => { execCalls.push({ command, arg }); },
    frankenCommands: {},
    invertedFrankenCommands: {},
  },
});

let targetTempF = 82;
mock.module(new URL('./frankenServer.js', import.meta.url).href, {
  namedExports: {
    getDeviceStatusCoalesced: async () => ({
      left: { targetTemperatureF: targetTempF },
      right: { targetTemperatureF: targetTempF },
    }),
    connectFranken: async () => ({}),
    FrankenCommandTimeoutError: class extends Error {},
  },
});

let recordedEvents: Array<{ type: string; opts: any }> = [];
mock.module(new URL('../db/collector.js', import.meta.url).href, {
  namedExports: {
    recordEvent: (type: string, opts: any) => { recordedEvents.push({ type, opts }); },
    recordConfigAudit: () => {},
    startCollector: () => {},
  },
});

let ButtonMonitor: typeof import('./buttonMonitor.js')['ButtonMonitor'];
let settingsDB: typeof import('../db/settings.js')['default'];
let memoryDB: typeof import('../db/memoryDB.js')['default'];

before(async () => {
  ({ ButtonMonitor } = await import('./buttonMonitor.js'));
  ({ default: settingsDB } = await import('../db/settings.js'));
  ({ default: memoryDB } = await import('../db/memoryDB.js'));
});

// --- RAW fixture helpers (same framing as rawLogReader.test) ---------------
function frameRecord(seq: number, data: Buffer): Buffer {
  const enc = (n: number): Buffer => (n <= 0x17 ? Buffer.from([n]) : Buffer.from([0x18, n]));
  const bsHeader = (len: number): Buffer =>
    len <= 0x17 ? Buffer.from([0x40 | len]) : Buffer.from([0x58, len]);
  return Buffer.concat([
    Buffer.from([0xa2]),
    Buffer.from([0x63, 0x73, 0x65, 0x71]),
    enc(seq),
    Buffer.from([0x64, 0x64, 0x61, 0x74, 0x61]),
    bsHeader(data.length),
    data,
  ]);
}
const logRec = (msg: string, seq = 1): Buffer =>
  frameRecord(seq, cbor.encode({ type: 'log', ts: 1, level: 'info', msg, seq }));

function pressReleaseLog(sideTag: 'R' | 'L', code: number, seq = 1): Buffer {
  return Buffer.concat([
    logRec(`[tca8418${sideTag}] gpi press ${code}`, seq),
    logRec(`[tca8418${sideTag}] gpi release ${code}`, seq),
  ]);
}

// Access the private tick() to drive polls deterministically.
type Internals = { tick(): Promise<void> };

function writeRaw(name: string, buf: Buffer, mtimeSec: number): string {
  const full = path.join(rawDir, name);
  writeFileSync(full, buf);
  utimesSync(full, mtimeSec, mtimeSec);
  return full;
}

function appendRaw(full: string, buf: Buffer, mtimeSec: number): void {
  appendFileSync(full, buf);
  utimesSync(full, mtimeSec, mtimeSec);
}

describe('ButtonMonitor dispatch', () => {
  beforeEach(async () => {
    tempCalls = []; updateCalls = []; execCalls = []; recordedEvents = [];
    // Clean the raw dir.
    for (const f of readdirSync(rawDir)) rmSync(path.join(rawDir, f));
    targetTempF = 82;

    await settingsDB.read();
    for (const side of ['left', 'right'] as const) {
      settingsDB.data[side].buttons = {
        invertButtons: false, stepF: 1, doubleClickWindowMs: 2000, hapticEcho: false,
      };
    }
    settingsDB.data.features.coverButtons = true;
    await settingsDB.write();

    await memoryDB.read();
    memoryDB.data.left.isAlarmVibrating = false;
    memoryDB.data.right.isAlarmVibrating = false;
    await memoryDB.write();
  });

  it('top click raises temperature by stepF on the right side', async () => {
    writeRaw('001.RAW', pressReleaseLog('R', 97), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();

    assert.equal(tempCalls.length, 1);
    assert.deepEqual(tempCalls[0], { side: 'right', current: 82, delta: 1 });
    const ev = recordedEvents.find(e => e.type === 'button_press');
    assert.equal(ev?.opts.payload.action, 'temp_up');
  });

  it('bottom click lowers temperature by stepF on the left side', async () => {
    writeRaw('001.RAW', pressReleaseLog('L', 99), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();

    assert.equal(tempCalls.length, 1);
    assert.deepEqual(tempCalls[0], { side: 'left', current: 82, delta: -1 });
  });

  it('invertButtons swaps top/bottom polarity', async () => {
    await settingsDB.read();
    settingsDB.data.right.buttons.invertButtons = true;
    await settingsDB.write();

    writeRaw('001.RAW', pressReleaseLog('R', 97), 1000); // physical top
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();

    // Inverted: top now decrements.
    assert.deepEqual(tempCalls[0], { side: 'right', current: 82, delta: -1 });
  });

  it('respects a non-default stepF', async () => {
    await settingsDB.read();
    settingsDB.data.right.buttons.stepF = 3;
    await settingsDB.write();
    writeRaw('001.RAW', pressReleaseLog('R', 97), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();
    assert.equal(tempCalls[0].delta, 3);
  });

  it('middle double-click dismisses a vibrating alarm on that side', async () => {
    await memoryDB.read();
    memoryDB.data.right.isAlarmVibrating = true;
    await memoryDB.write();

    // Two middle press/release pairs = two clicks within the window.
    writeRaw('001.RAW', Buffer.concat([
      pressReleaseLog('R', 98),
      pressReleaseLog('R', 98),
    ]), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();

    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0], { right: { isAlarmVibrating: false } });
    assert.equal(tempCalls.length, 0, 'middle must not touch temperature');
  });

  it('middle double-click is a no-op when no alarm is vibrating', async () => {
    writeRaw('001.RAW', Buffer.concat([
      pressReleaseLog('L', 98),
      pressReleaseLog('L', 98),
    ]), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();

    assert.equal(updateCalls.length, 0);
    const ev = recordedEvents.find(e => e.opts?.payload?.action === 'dismiss_noop');
    assert.ok(ev, 'expected a dismiss_noop event');
  });

  it('a single middle click does nothing', async () => {
    writeRaw('001.RAW', pressReleaseLog('R', 98), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();
    assert.equal(updateCalls.length, 0);
    assert.equal(tempCalls.length, 0);
  });

  it('does nothing when coverButtons is disabled', async () => {
    await settingsDB.read();
    settingsDB.data.features.coverButtons = false;
    await settingsDB.write();
    writeRaw('001.RAW', pressReleaseLog('R', 97), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();
    assert.equal(tempCalls.length, 0);
  });

  it('fires a haptic pulse when hapticEcho is enabled, then clears it', async () => {
    await settingsDB.read();
    settingsDB.data.right.buttons.hapticEcho = true;
    await settingsDB.write();
    writeRaw('001.RAW', pressReleaseLog('R', 97), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();

    // The ALARM_RIGHT pulse fires synchronously in dispatch; the clear is on a
    // 1s timer. Assert at least the pulse went out.
    const pulse = execCalls.find(c => c.command === 'ALARM_RIGHT');
    assert.ok(pulse, 'expected an ALARM_RIGHT haptic pulse');
    // Wait for the clear timer.
    await new Promise(r => setTimeout(r, 1100));
    assert.ok(execCalls.some(c => c.command === 'ALARM_CLEAR'), 'expected the pulse to be cleared');
  });

  it('never fires a haptic while an alarm is vibrating', async () => {
    await settingsDB.read();
    settingsDB.data.right.buttons.hapticEcho = true;
    await settingsDB.write();
    await memoryDB.read();
    memoryDB.data.right.isAlarmVibrating = true;
    await memoryDB.write();

    writeRaw('001.RAW', pressReleaseLog('R', 97), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();
    assert.equal(execCalls.filter(c => c.command === 'ALARM_RIGHT').length, 0);
  });

  it('reads only appended bytes across successive ticks (no re-fire)', async () => {
    const full = writeRaw('001.RAW', pressReleaseLog('R', 97, 1), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();
    assert.equal(tempCalls.length, 1);

    // Append a second press; the first must not fire again.
    appendRaw(full, pressReleaseLog('R', 99, 2), 1001);
    await mon.tick();
    assert.equal(tempCalls.length, 2, 'only the newly appended press should fire');
    assert.equal(tempCalls[1].delta, -1); // bottom
  });

  it('rolls over to a newer file and starts from its top', async () => {
    writeRaw('001.RAW', pressReleaseLog('R', 97, 1), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();
    assert.equal(tempCalls.length, 1);

    // A newer file (higher mtime) appears; frank rolled over. Its press must be
    // read from offset 0 of the NEW file.
    writeRaw('002.RAW', pressReleaseLog('L', 99, 1), 2000);
    await mon.tick();
    assert.equal(tempCalls.length, 2);
    assert.equal(tempCalls[1].side, 'left');
    assert.equal(tempCalls[1].delta, -1);
  });

  it('ignores SEQNO.RAW when picking the newest file', async () => {
    // SEQNO.RAW has the newest mtime but must be skipped.
    writeRaw('001.RAW', pressReleaseLog('R', 97, 1), 1000);
    writeRaw('SEQNO.RAW', Buffer.from([1, 2, 3, 4]), 5000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();
    assert.equal(tempCalls.length, 1, 'should tail 001.RAW, not SEQNO.RAW');
  });

  it('survives a corrupt byte in the stream and still parses later records', async () => {
    const junk = Buffer.from([0x55, 0x55]);
    writeRaw('001.RAW', Buffer.concat([junk, pressReleaseLog('R', 97)]), 1000);
    const mon = new ButtonMonitor() as unknown as Internals;
    await mon.tick();
    assert.equal(tempCalls.length, 1, 'resynced past the junk and parsed the press');
  });
});
