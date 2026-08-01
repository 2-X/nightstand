import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';

// Isolated DATA_FOLDER, set before the dynamic imports (config.ts reads it at
// import time). Same pattern as jobs/scheduleOverride.test.ts.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'nightstand-schedules-validation-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';

let schedulesRouter: express.Router;
let schedulesDB: typeof import('../../db/schedules.js')['default'];
let SchedulesUpdateSchema: typeof import('../../db/schedulesSchema.js')['SchedulesUpdateSchema'];
let MAX_ALARMS_PER_DAY: typeof import('../../db/schedulesSchema.js')['MAX_ALARMS_PER_DAY'];

let server: Server;
let baseUrl: string;

before(async () => {
  ({ default: schedulesRouter } = await import('./schedules.js'));
  ({ default: schedulesDB } = await import('../../db/schedules.js'));
  ({ SchedulesUpdateSchema, MAX_ALARMS_PER_DAY } = await import('../../db/schedulesSchema.js'));

  const app = express();
  app.use(express.json());
  app.use(schedulesRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
});

const validAlarm = {
  enabled: true,
  time: '07:00',
  vibrationIntensity: 100,
  vibrationPattern: 'rise',
  duration: 60,
  alarmTemperature: 82,
};

const postSchedules = async (body: unknown) => {
  const res = await fetch(`${baseUrl}/schedules`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

describe('POST /schedules partial updates', () => {
  it('accepts a partial power patch', async () => {
    const res = await postSchedules({ left: { monday: { power: { enabled: true } } } });
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('accepts a complete alarm', async () => {
    const res = await postSchedules({ left: { monday: { alarms: [validAlarm] } } });
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    await schedulesDB.read();
    assert.equal(schedulesDB.data.left.monday.alarms[0].time, '07:00');
  });

  it('accepts an empty alarms array, which is how the UI clears alarms', async () => {
    const res = await postSchedules({ left: { monday: { alarms: [] } } });
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  });
});

describe('POST /schedules alarm validation', () => {
  it('rejects an alarm entry with no time field', async () => {
    // A recurring alarm with `enabled: true` but no `time` is nonsense: there
    // is no moment for it to fire at, and the scheduler splits that string.
    const res = await postSchedules({ left: { monday: { alarms: [{ enabled: true }] } } });
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('rejects an alarm entry missing vibration/duration fields', async () => {
    // These flow straight into the CBOR payload sent to the pod hardware.
    const res = await postSchedules({ left: { wednesday: { alarms: [{ enabled: true, time: '07:00' }] } } });
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('rejects an incomplete legacy singular alarm', async () => {
    const res = await postSchedules({ left: { monday: { alarm: { enabled: true } } } });
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('keeps the existing error response shape', async () => {
    const res = await postSchedules({ left: { monday: { alarms: [{ enabled: true }] } } });
    assert.equal(res.body.error, 'Invalid request data');
    assert.ok(Array.isArray(res.body.details));
  });

  it('does not persist a timeless alarm into schedulesDB', async () => {
    await postSchedules({ left: { tuesday: { alarms: [{ enabled: true }] } } });
    await schedulesDB.read();
    const stored = schedulesDB.data.left.tuesday;
    assert.ok(
      stored.alarms.every((a) => typeof a.time === 'string'),
      `stored alarms lost their time: ${JSON.stringify(stored.alarms)}`,
    );
    assert.equal(
      typeof stored.alarm.time,
      'string',
      `primary alarm lost its time: ${JSON.stringify(stored.alarm)}`,
    );
  });

  it('rejects a schema-level empty alarm object', () => {
    const parsed = SchedulesUpdateSchema.safeParse({ left: { monday: { alarms: [{}] } } });
    assert.equal(parsed.success, false, 'the update schema accepted an entirely empty alarm entry');
  });

  it('caps the number of alarms per day', async () => {
    const res = await postSchedules({
      left: { friday: { alarms: Array.from({ length: MAX_ALARMS_PER_DAY + 1 }, () => validAlarm) } },
    });
    assert.equal(res.status, 400, `expected 400 past the cap, got ${res.status}`);
  });

  it('allows exactly the cap', async () => {
    const res = await postSchedules({
      left: { friday: { alarms: Array.from({ length: MAX_ALARMS_PER_DAY }, () => validAlarm) } },
    });
    assert.equal(res.status, 200, `expected 200 at the cap, got ${res.status}: ${JSON.stringify(res.body)}`);
  });
});
