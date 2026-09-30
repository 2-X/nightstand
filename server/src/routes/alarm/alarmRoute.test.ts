import assert from 'node:assert/strict';
import { after, beforeEach, describe, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-alarm-route-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

let result = 10_000;
let release: (() => void) | undefined;
let started = 0;
mock.module(new URL('../../jobs/alarmScheduler.js', import.meta.url).href, {
  namedExports: {
    executeAlarm: async () => {
      started++;
      if (release === undefined) return result;
      await new Promise<void>(resolve => { release = resolve; });
      return result;
    },
  },
});

const { default: router } = await import('./alarm.js');
const app = express();
app.use(express.json(), router);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/alarm`;
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});

const alarm = { side: 'left', vibrationIntensity: 1, vibrationPattern: 'rise', duration: 10, force: true };
const post = (body: unknown) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  result = 10_000;
  release = undefined;
  started = 0;
});

describe('POST /alarm', () => {
  it('answers 200 once the alarm has started', async () => {
    const response = await post(alarm);
    assert.equal(response.status, 200);
    await response.json();
    assert.equal(started, 1);
  });

  it('answers 503 with a message when the alarm did not start', async () => {
    result = 0;
    const response = await post(alarm);
    assert.equal(response.status, 503);
    const body = await response.json() as { error: { message: string } };
    assert.match(body.error.message, /did not start/);
  });

  it('waits for the start command before answering', async () => {
    release = () => undefined;
    let answered = false;
    const pending = post(alarm).then(response => { answered = true; return response.text(); });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(started, 1);
    assert.equal(answered, false);
    release();
    await pending;
    assert.equal(answered, true);
  });

  it('still rejects an invalid body', async () => {
    const response = await post({ ...alarm, side: 'middle' });
    assert.equal(response.status, 400);
    await response.text();
    assert.equal(started, 0);
  });
});
