import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { DeviceStatus, SideStatus } from '../routes/deviceStatus/deviceStatusSchema.js';
import type { AlarmJob, Side } from '../db/schedulesSchema.js';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-tap-alarm-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const dismissed: Side[] = [];
let dismissRejectsWith: Error | null = null;
mock.module(new URL('./dismissAlarm.js', import.meta.url).href, {
  namedExports: {
    dismissAlarm: async (side: Side) => {
      dismissed.push(side);
      if (dismissRejectsWith) throw dismissRejectsWith;
    },
  },
});

const alarms: Array<{ job: AlarmJob; options: unknown }> = [];
let alarmRingMs = 10_000;
mock.module(new URL('../jobs/alarmScheduler.js', import.meta.url).href, {
  namedExports: {
    executeAlarm: async (job: AlarmJob, _occurrenceId: unknown, options: unknown) => {
      alarms.push({ job, options });
      return alarmRingMs;
    },
  },
});

const updates: unknown[] = [];
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: { updateDeviceStatus: async (update: unknown) => { updates.push(update); } },
});

// The real module starts a BLE initialize() at import time.
mock.module(new URL('./trimixBaseControl.js', import.meta.url).href, {
  namedExports: { trimixBase: { goToFlat: async () => {}, setPosition: async () => {} } },
});

let handleAlarmTap: typeof import('./tapAlarm.js')['handleAlarmTap'];
let FrankenMonitor: typeof import('./frankenMonitor.js')['FrankenMonitor'];
let activeAlarmsModule: typeof import('../jobs/activeAlarms.js');
let settingsDB: typeof import('../db/settings.js')['default'];
let memoryDB: typeof import('../db/memoryDB.js')['default'];
let serverStatus: typeof import('../serverStatus.js')['default'];
let logger: typeof import('../logger.js')['default'];

before(async () => {
  ({ handleAlarmTap } = await import('./tapAlarm.js'));
  ({ FrankenMonitor } = await import('./frankenMonitor.js'));
  activeAlarmsModule = await import('../jobs/activeAlarms.js');
  ({ default: settingsDB } = await import('../db/settings.js'));
  ({ default: memoryDB } = await import('../db/memoryDB.js'));
  ({ default: serverStatus } = await import('../serverStatus.js'));
  ({ default: logger } = await import('../logger.js'));
});
after(() => rmSync(folder, { recursive: true, force: true }));

const ringing = { vibrationIntensity: 40, duration: 120, vibrationPattern: 'rise' } as const;
const tap = (overrides: Partial<{ behavior: 'snooze' | 'dismiss'; inactiveAlarmBehavior: 'power' | 'none' }> = {}) => ({
  type: 'alarm' as const,
  behavior: 'snooze' as const,
  snoozeDuration: 300,
  inactiveAlarmBehavior: 'power' as const,
  ...overrides,
});

async function ring(side: Side) {
  activeAlarmsModule.activeAlarms.set(side, { ...ringing });
  memoryDB.data[side].isAlarmVibrating = true;
  await memoryDB.write();
}

beforeEach(async () => {
  dismissed.length = 0;
  alarms.length = 0;
  updates.length = 0;
  dismissRejectsWith = null;
  alarmRingMs = 10_000;
  for (const side of ['left', 'right'] as const) {
    activeAlarmsModule.forgetActiveAlarm(side);
    memoryDB.data[side].isAlarmVibrating = false;
  }
  await memoryDB.write();
  await settingsDB.read();
  settingsDB.data.left.awayMode = false;
  settingsDB.data.right.awayMode = false;
  await settingsDB.write();
});

describe('alarm tap while the alarm is ringing', () => {
  it('dismisses it when set to dismiss', async () => {
    await ring('left');
    await handleAlarmTap('left', tap({ behavior: 'dismiss' }));

    assert.deepEqual(dismissed, ['left']);
    assert.equal(activeAlarmsModule.activeAlarms.has('left'), false);
    assert.equal(memoryDB.data.left.isAlarmVibrating, false);
    assert.deepEqual(alarms, []);
    assert.deepEqual(updates, [], 'a ringing alarm must not toggle power');
  });

  it('only touches the tapped side', async () => {
    await ring('left');
    await ring('right');
    await handleAlarmTap('right', tap({ behavior: 'dismiss' }));

    assert.deepEqual(dismissed, ['right']);
    assert.equal(memoryDB.data.left.isAlarmVibrating, true);
    assert.ok(activeAlarmsModule.activeAlarms.has('left'));
  });

  it('snoozes it: stops it now and rings again with the same settings after the snooze', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
    await ring('left');
    await handleAlarmTap('left', tap({ behavior: 'snooze' }));

    assert.deepEqual(dismissed, ['left']);
    assert.equal(memoryDB.data.left.isAlarmVibrating, false);
    assert.equal(activeAlarmsModule.hasSnooze('left'), true);

    t.mock.timers.tick(299_999);
    assert.equal(alarms.length, 0, 'rang before the snooze was up');

    t.mock.timers.tick(1);
    assert.equal(alarms.length, 1);
    assert.deepEqual(alarms[0].job, { side: 'left', ...ringing, force: true });
    assert.deepEqual(alarms[0].options, { background: true, dueAt: 1_800_000_300_000 });
    assert.equal(activeAlarmsModule.hasSnooze('left'), false);
  });

  it('still arms the snooze when stopping the alarm fails', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dismissRejectsWith = new Error('franken write failed');
    await ring('left');

    await assert.rejects(handleAlarmTap('left', tap({ behavior: 'snooze' })), /franken write failed/);
    t.mock.timers.tick(300_000);
    assert.equal(alarms.length, 1);
  });

  it('logs and carries on when the snoozed alarm does not ring', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const warn = t.mock.method(logger, 'warn', () => logger);
    alarmRingMs = 0;
    await ring('left');
    await handleAlarmTap('left', tap({ behavior: 'snooze' }));
    t.mock.timers.tick(300_000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(alarms.length, 1);
    assert.deepEqual(warn.mock.calls.map(call => call.arguments[0]), ['[tap] The snoozed alarm on the left side did not ring']);
  });
});

describe('alarm tap while an alarm is snoozed', () => {
  it('a dismiss tap cancels the snooze without touching power', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await ring('left');
    await handleAlarmTap('left', tap({ behavior: 'snooze' }));
    await handleAlarmTap('left', tap({ behavior: 'dismiss' }));

    t.mock.timers.tick(600_000);
    assert.deepEqual(alarms, []);
    assert.deepEqual(updates, []);
  });

  it('a snooze tap keeps the snooze time and leaves power alone', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await ring('left');
    await handleAlarmTap('left', tap({ behavior: 'snooze' }));
    t.mock.timers.tick(200_000);
    await handleAlarmTap('left', tap({ behavior: 'snooze' }));

    t.mock.timers.tick(100_000);
    assert.equal(alarms.length, 1);
    assert.deepEqual(updates, []);
  });

  it('a dismiss from the app cancels the snooze', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await ring('left');
    await handleAlarmTap('left', tap({ behavior: 'snooze' }));
    activeAlarmsModule.forgetActiveAlarm('left');

    t.mock.timers.tick(600_000);
    assert.deepEqual(alarms, []);
  });
});

describe('alarm tap with no alarm', () => {
  it('sends no power command when set to power', async () => {
    await handleAlarmTap('left', tap({ inactiveAlarmBehavior: 'power' }));
    assert.deepEqual(updates, []);
    assert.deepEqual(dismissed, []);
    assert.deepEqual(alarms, []);
  });

  it('does nothing when set to none', async () => {
    await handleAlarmTap('left', tap({ inactiveAlarmBehavior: 'none' }));
    assert.deepEqual(updates, []);
    assert.deepEqual(dismissed, []);
    assert.deepEqual(alarms, []);
  });

  it('does not count the other side\'s alarm', async () => {
    await ring('right');
    await handleAlarmTap('left', tap({ behavior: 'dismiss' }));
    assert.deepEqual(dismissed, []);
    assert.deepEqual(updates, []);
  });
});

const side = (taps: SideStatus['taps'], isOn = true): SideStatus => ({
  currentTemperatureLevel: 0,
  currentTemperatureF: 82,
  targetTemperatureF: 82,
  secondsRemaining: isOn ? 3_600 : 0,
  isOn,
  isAlarmVibrating: false,
  taps,
});

const deviceStatus = (leftTaps: SideStatus['taps'], leftOn = true): DeviceStatus => ({
  left: side(leftTaps, leftOn),
  right: side({ doubleTap: 0, tripleTap: 0, quadTap: 0 }),
  waterLevel: 'true',
  isPriming: false,
  settings: { v: 1, gainLeft: 0, gainRight: 0, ledBrightness: 100 },
  coverVersion: '1',
  hubVersion: '1',
  freeSleep: { version: '3.0.1', branch: 'main' },
  wifiStrength: 70,
  sensorTemps: null,
});

async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    await new Promise((resolve) => setImmediate(resolve));
  }
}

type GestureInternals = { deviceStatus?: DeviceStatus; processGestures(next: DeviceStatus): void };

async function runGestureTick(previous: DeviceStatus, next: DeviceStatus) {
  const monitor = new FrankenMonitor() as unknown as GestureInternals;
  monitor.deviceStatus = previous;
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    monitor.processGestures(next);
    await settle();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return seen;
}

describe('alarm taps from the gesture loop', () => {
  beforeEach(async () => {
    serverStatus.status.frankenMonitor.status = 'healthy';
    serverStatus.status.frankenMonitor.message = '';
    settingsDB.data.left.taps.tripleTap = tap({ behavior: 'dismiss' });
    await settingsDB.write();
  });

  it('dismisses a ringing alarm on a tap', async () => {
    await ring('left');
    const seen = await runGestureTick(
      deviceStatus({ doubleTap: 0, tripleTap: 1, quadTap: 0 }),
      deviceStatus({ doubleTap: 0, tripleTap: 2, quadTap: 0 }),
    );
    assert.deepEqual(dismissed, ['left']);
    assert.deepEqual(seen, []);
  });

  it('catches a failed dismiss and reports it on the service status', async () => {
    dismissRejectsWith = new Error('franken write failed');
    await ring('left');
    const seen = await runGestureTick(
      deviceStatus({ doubleTap: 0, tripleTap: 1, quadTap: 0 }),
      deviceStatus({ doubleTap: 0, tripleTap: 2, quadTap: 0 }),
    );
    assert.deepEqual(dismissed, ['left']);
    assert.deepEqual(seen, [], 'a failed dismiss escaped as an unhandled rejection');
    assert.equal(serverStatus.status.frankenMonitor.status, 'failed');
    assert.match(serverStatus.status.frankenMonitor.message, /franken write failed/);
  });

  it('sends no power command for a power tap when no alarm is ringing', async () => {
    settingsDB.data.left.taps.tripleTap = tap({ behavior: 'dismiss', inactiveAlarmBehavior: 'power' });
    const seen = await runGestureTick(
      deviceStatus({ doubleTap: 0, tripleTap: 1, quadTap: 0 }, true),
      deviceStatus({ doubleTap: 0, tripleTap: 2, quadTap: 0 }, true),
    );
    assert.deepEqual(updates, []);
    assert.deepEqual(dismissed, []);
    assert.deepEqual(seen, []);
  });

  it('does nothing when the tapped gesture has no action set', async () => {
    // Settings written before tap actions existed can lack the key.
    delete (settingsDB.data.left.taps as Partial<typeof settingsDB.data.left.taps>).tripleTap;
    await ring('left');
    const seen = await runGestureTick(
      deviceStatus({ doubleTap: 0, tripleTap: 1, quadTap: 0 }),
      deviceStatus({ doubleTap: 0, tripleTap: 2, quadTap: 0 }),
    );
    assert.deepEqual(dismissed, []);
    assert.deepEqual(updates, []);
    assert.deepEqual(alarms, []);
    assert.deepEqual(seen, []);
    assert.equal(serverStatus.status.frankenMonitor.status, 'healthy');
  });
});
