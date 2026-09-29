import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import fs, { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ExecException } from 'node:child_process';
import express from 'express';
import schedule from 'node-schedule';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-python-queue-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const errors: string[] = [];
mock.module(new URL('../logger.js', import.meta.url).href, {
  defaultExport: { debug() {}, info() {}, error(message: string) { errors.push(message); } },
});
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: { updateDeviceStatus: async () => { throw new Error('Unexpected hardware command'); } },
});
type Invocation = { command: string; done: boolean; finish: (error?: ExecException) => void };
const calls: Invocation[] = [];
let throwOnSpawn = false;
mock.module('child_process', {
  namedExports: {
    exec(command: string, _options: unknown, callback: (error: ExecException | null, stdout: string, stderr: string) => void) {
      if (throwOnSpawn) {
        throwOnSpawn = false;
        throw new Error('spawn failed synchronously');
      }
      const call: Invocation = { command, done: false, finish(error) {
        if (call.done) return;
        call.done = true;
        callback(error ?? null, '', error ? 'child failed' : '');
      } };
      calls.push(call);
    },
    spawn() { throw new Error('Unexpected service command'); },
    execFile() { throw new Error('Unexpected privileged command'); },
  },
});
const access = fs.promises.access.bind(fs.promises);
mock.method(fs.promises, 'access', async (file: fs.PathLike, mode?: number) => {
  if (file === '/home/dac/venv/bin/python') return;
  await access(file, mode);
});
const { executePythonScript } = await import('./executePython.js');
const { executeAnalyzeSleep } = await import('./analyzeSleep.js');
const { executeCalibrateSensors } = await import('./calibrateSensors.js');
const { scheduleSleepAnalysis } = await import('./powerScheduler.js');
const { default: settings } = await import('../db/settings.js');
const { default: services } = await import('../db/services.js');
const { default: memory } = await import('../db/memoryDB.js');
const { default: jobsRouter } = await import('../routes/jobs/jobs.js');
const app = express();
app.use(express.json(), jobsRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const start = '2026-09-27T12:00:00Z';
const end = '2026-09-28T13:00:00Z';

beforeEach(() => { calls.length = 0; errors.length = 0; throwOnSpawn = false; });
afterEach(async () => {
  for (let turn = 0; turn < 5; turn++) {
    calls.forEach(call => call.finish());
    await flush();
  }
  Object.keys(schedule.scheduledJobs).forEach(name => schedule.cancelJob(name));
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});

test('the completion promise stays pending until the child exits', async () => {
  let completed = false;
  const result = executePythonScript({ script: 'analysis.py' }).then(() => { completed = true; });
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(completed, false);
  calls[0].finish();
  await result;
  assert.equal(completed, true);
});

test('two analysis jobs never overlap', async () => {
  executeAnalyzeSleep('left', start, end);
  executeAnalyzeSleep('right', start, end);
  await flush();
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /analyze_sleep.py --side=left/);
  calls[0].finish();
  await flush();
  assert.equal(calls.length, 2);
  assert.match(calls[1].command, /analyze_sleep.py --side=right/);
});

test('calibration shares the analysis queue in request order', async () => {
  executeAnalyzeSleep('left', start, end);
  executeCalibrateSensors('right', start, end, true);
  executeAnalyzeSleep('right', start, end);
  await flush();
  assert.equal(calls.length, 1);
  calls[0].finish();
  await flush();
  assert.equal(calls.length, 2);
  assert.match(calls[1].command, /calibrate_sensor_thresholds.py --side=right .* --force$/);
  calls[1].finish();
  await flush();
  assert.equal(calls.length, 3);
  assert.match(calls[2].command, /analyze_sleep.py --side=right/);
});

for (const [name, detail] of [
  ['nonzero exit', { code: 1 }],
  ['crash', { signal: 'SIGKILL' as const, killed: true }],
  ['spawn error', { errno: -2, syscall: 'spawn' }],
] as const) {
  test(`a child ${name} releases the next queued job`, async () => {
    executeAnalyzeSleep('left', start, end);
    executeAnalyzeSleep('right', start, end);
    await flush();
    assert.equal(calls.length, 1);
    calls[0].finish(Object.assign(new Error(name), detail));
    await flush();
    assert.equal(calls.length, 2);
    assert.match(calls[1].command, /--side=right/);
    assert.equal(errors.length, 1);
  });
}

test('a manual request waits for the running noon analysis', async () => {
  settings.data.timeZone = 'UTC';
  settings.data.left.awayMode = false;
  services.data.biometrics.enabled = true;
  await services.write();
  memory.data.left.analyzeSleep = {};
  await memory.write();
  scheduleSleepAnalysis(settings.data, 'left');
  await schedule.scheduledJobs['daily-analyze-sleep-left'].invoke();
  await flush();
  assert.equal(calls.length, 1);
  const response = await fetch(`${url}/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(['analyzeSleepRight', 'biometricsCalibrationLeft']),
  });
  assert.equal(response.status, 204);
  await response.text();
  await flush();
  assert.equal(calls.length, 1);
  calls[0].finish();
  await flush();
  assert.equal(calls.length, 2);
  assert.match(calls[1].command, /analyze_sleep.py --side=right/);
  calls[1].finish();
  await flush();
  assert.equal(calls.length, 3);
  assert.match(calls[2].command, /calibrate_sensor_thresholds.py --side=left .* --force$/);
});

test('a synchronous spawn failure releases the next queued job', async () => {
  throwOnSpawn = true;
  const first = executePythonScript({ script: 'analysis.py' });
  const second = executePythonScript({ script: 'calibration.py' });
  await first;
  await flush();
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /calibration.py/);
  calls[0].finish();
  await second;
  assert.equal(errors.length, 1);
});
