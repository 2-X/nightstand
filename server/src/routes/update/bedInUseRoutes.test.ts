import fs from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StartHooks } from '../../jobs/privilegedCommand.js';
import type { InUseReasonText } from './inUseText.js';

const folder = mkdtempSync(path.join(tmpdir(), 'bed-in-use-routes-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const TARGET_FILE = '/persistent/free-sleep-data/update-target.json';
let reasons: InUseReasonText[] = [];
const started: string[] = [];
const targetWrites: string[] = [];
const writeFile = fs.promises.writeFile.bind(fs.promises);
mock.method(fs.promises, 'writeFile', async (...args: Parameters<typeof fs.promises.writeFile>) => {
  if (args[0] === TARGET_FILE) targetWrites.push(String(args[1]));
  else await writeFile(...args);
});
const trigger = async (hooks: StartHooks = {}) => {
  await hooks.beforeStart?.();
  started.push('started');
};
for (const [file, name] of [
  ['update', 'triggerUpdateService'], ['rollback', 'triggerRollbackService'], ['revertToStock', 'triggerRevertToStockService'],
]) {
  mock.module(new URL(`../../jobs/${file}.js`, import.meta.url).href, { namedExports: { [name]: trigger } });
}

let server: Server;
let url: string;
let setInUseCheck: typeof import('./update.js')['setInUseCheck'];
let setResultFileForTests: typeof import('./update.js')['setResultFileForTests'];
before(async () => {
  const app = express();
  app.use(express.json());
  const update = await import('./update.js');
  ({ setInUseCheck, setResultFileForTests } = update);
  setResultFileForTests(path.join(folder, 'update-result.json'));
  setInUseCheck(async () => reasons);
  app.use('/api/update', update.default);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
beforeEach(() => {
  reasons = [];
  started.length = 0;
  targetWrites.length = 0;
});

const send = async (method: string, route: string, body?: unknown) => {
  const response = await fetch(`${url}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as { error: string; reasons: string[] } };
};
const post = (route: string, body?: unknown) => send('POST', route, body);

const routes = [
  ['/api/update', {}], ['/api/update/rollback', undefined], ['/api/update/revert-to-stock', undefined],
] as const;
for (const [route, body] of routes) {
  describe(route, () => {
    it('refuses while the bed may be in use, without starting anything', async () => {
      reasons = ['left-on'];
      const response = await post(route, body);
      assert.equal(response.status, 409);
      assert.deepEqual(response.body.reasons, ['left-on']);
      assert.match(response.body.error, /^A side is on\./);
      assert.equal(started.length, 0);
    });
    it('refuses for each reason with its own text', async () => {
      for (const [reason, text] of [
        ['right-on', 'A side is on. The bed keeps its current temperature, but schedules and alarms stop for up to five minutes.'],
        ['alarm-soon', 'An alarm is due in the next 15 minutes. If it falls while Nightstand restarts, it will not ring.'],
        ['status-unknown', "Nightstand cannot read the bed's state right now, so someone may be using it."],
      ] as const) {
        reasons = [reason];
        const response = await post(route, body);
        assert.equal(response.status, 409);
        assert.equal(response.body.error, text);
      }
      assert.equal(started.length, 0);
    });
    it('goes ahead when confirmed', async () => {
      reasons = ['alarm-soon'];
      assert.equal((await post(route, { ...(body ?? {}), confirmInUse: true })).status, 204);
      assert.equal(started.length, 1);
    });
    it('does not take a confirmation that is not exactly true', async () => {
      reasons = ['status-unknown'];
      assert.equal((await post(route, { ...(body ?? {}), confirmInUse: false })).status, 409);
      for (const confirmInUse of ['true', 1]) {
        assert.equal((await post(route, { ...(body ?? {}), confirmInUse })).status, 400);
      }
      assert.equal(started.length, 0);
    });
    it('goes ahead without confirmation when the bed is idle', async () => {
      reasons = [];
      assert.equal((await post(route, body)).status, 204);
      assert.equal(started.length, 1);
    });
  });
}

it('reports the reasons to the app', async () => {
  reasons = ['status-unknown'];
  assert.deepEqual((await send('GET', '/api/update/in-use')).body, { reasons: ['status-unknown'] });
  reasons = [];
  assert.deepEqual((await send('GET', '/api/update/in-use')).body, { reasons: [] });
});
it('rejects unknown fields on rollback and switch', async () => {
  for (const route of ['/api/update/rollback', '/api/update/revert-to-stock']) {
    const response = await post(route, { confirmInUse: true, extra: 1 });
    assert.equal(response.status, 400);
  }
  assert.equal(started.length, 0);
});
it('never writes confirmInUse into the target file', async () => {
  await post('/api/update', { targetVersion: '3.6.0', confirmInUse: true });
  assert.equal(targetWrites.length, 1);
  assert.deepEqual(JSON.parse(targetWrites[0]), { version: '3.6.0', allowDowngrade: false });
});
it('does not write a target file for a refused update', async () => {
  reasons = ['left-on'];
  await post('/api/update', { targetVersion: '3.6.0' });
  assert.deepEqual(targetWrites, []);
});
it('treats a check that throws as the bed possibly being in use', async () => {
  setInUseCheck(async () => { throw new Error('boom'); });
  try {
    assert.deepEqual((await send('GET', '/api/update/in-use')).body, { reasons: ['status-unknown'] });
    assert.equal((await post('/api/update/rollback')).status, 409);
    assert.equal(started.length, 0);
  } finally {
    setInUseCheck(async () => reasons);
  }
});
it('refuses without a registered check, as the updater overlay has none', async () => {
  const fresh = await import(`./update.js?no-check=${Date.now()}`) as typeof import('./update.js');
  const app = express();
  app.use(express.json());
  app.use('/api/update', fresh.default);
  const other = app.listen(0);
  await new Promise<void>(resolve => other.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${(other.address() as AddressInfo).port}/api/update`;
    const refused = await fetch(`${base}/rollback`, { method: 'POST' });
    assert.equal(refused.status, 409);
    assert.deepEqual((await refused.json() as { reasons: string[] }).reasons, ['status-unknown']);
    assert.equal(started.length, 0);
  } finally {
    other.closeAllConnections();
    await new Promise<void>(resolve => other.close(() => resolve()));
  }
});

describe('GET /api/update/last-result', () => {
  const resultFile = () => path.join(folder, 'update-result.json');
  const record = {
    runId: '1f2e3d4c', operation: 'update', outcome: 'rolled-back', from: '3.5.1', to: '3.6.0',
    message: 'the new version did not pass its health check', finishedAt: '2026-10-02T03:04:05Z',
  };
  beforeEach(() => fs.rmSync(resultFile(), { force: true }));

  it('returns what the script wrote', async () => {
    fs.writeFileSync(resultFile(), JSON.stringify(record));
    const response = await send('GET', '/api/update/last-result');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, record);
  });

  it('accepts a record with no versions', async () => {
    const bare = { ...record, from: null, to: null };
    fs.writeFileSync(resultFile(), JSON.stringify(bare));
    assert.deepEqual((await send('GET', '/api/update/last-result')).body, bare);
  });

  it('answers 404 when nothing has been recorded', async () => {
    assert.equal((await send('GET', '/api/update/last-result')).status, 404);
  });

  it('answers 404 for a file it cannot read as a result', async () => {
    for (const content of ['{not json', '{}', JSON.stringify({ ...record, outcome: 'exploded' }), JSON.stringify({ ...record, runId: 7 })]) {
      fs.writeFileSync(resultFile(), content);
      assert.equal((await send('GET', '/api/update/last-result')).status, 404, content);
    }
  });
});
