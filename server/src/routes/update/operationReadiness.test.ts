import fs from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrivilegedCommandError } from '../../jobs/privilegedCommand.js';

const folder = mkdtempSync(path.join(tmpdir(), 'operation-readiness-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
let fail = true;
let startFailed = false;
const targetWrites: string[] = [];
const targetDeletes: string[] = [];
const writeFile = fs.promises.writeFile.bind(fs.promises);
const unlink = fs.promises.unlink.bind(fs.promises);
mock.method(fs.promises, 'writeFile', async (...args: Parameters<typeof fs.promises.writeFile>) => {
  if (args[0] === '/persistent/free-sleep-data/update-target.json') targetWrites.push(args[0]);
  else await writeFile(...args);
});
mock.method(fs.promises, 'unlink', async (...args: Parameters<typeof fs.promises.unlink>) => {
  if (args[0] === '/persistent/free-sleep-data/update-target.json') targetDeletes.push(args[0]);
  else await unlink(...args);
});
const trigger = async (hooks: import('../../jobs/privilegedCommand.js').StartHooks = {}) => {
  await new Promise(resolve => setTimeout(resolve, 5));
  if (fail) throw new PrivilegedCommandError('A successful update repairs missing rules and services.');
  await hooks.beforeStart?.();
  if (startFailed) {
    await hooks.onStartFailure?.();
    throw new PrivilegedCommandError('Unable to start service');
  }
};
for (const [file, name] of [
  ['update', 'triggerUpdateService'], ['rollback', 'triggerRollbackService'], ['revertToStock', 'triggerRevertToStockService'],
]) {
  mock.module(new URL(`../../jobs/${file}.js`, import.meta.url).href, { namedExports: { [name]: trigger } });
}
mock.module(new URL('../../jobs/biometrics.js', import.meta.url).href, { namedExports: {
  triggerBiometricsDisable: trigger,
  shouldDisableBiometrics: (body: { biometrics?: { enabled?: boolean } }) => body.biometrics?.enabled === false,
  triggerBiometricsEnable: trigger,
  shouldEnableBiometrics: (body: { biometrics?: { enabled?: boolean } }) => body.biometrics?.enabled === true,
} });
const handoffs: string[] = [];
let handoffFails = false;
mock.module(new URL('../../jobs/rhythms/handoff.js', import.meta.url).href, { namedExports: {
  prepareToLeaveRhythms: async (reason: string) => {
    handoffs.push(reason);
    if (handoffFails) throw new Error('Pod unreachable');
    return { sides: [] };
  },
} });
let server: Server;
let url: string;
before(async () => {
  const app = express();
  app.use(express.json());
  const update = await import('./update.js');
  update.setLeaveHook((await import('../../jobs/rhythms/handoff.js')).prepareToLeaveRhythms);
  update.setInUseCheck(async () => []);
  app.use('/update', update.default);
  app.use((await import('../services/services.js')).default);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));

for (const endpoint of ['/update', '/update/rollback', '/update/switch-to-upstream', '/update/revert-to-stock', '/services']) {
  it(`${endpoint} waits for permission failure and reports repair instructions`, async () => {
    fail = true;
    if (endpoint === '/services') {
      const services = (await import('../../db/services.js')).default;
      services.data.biometrics.enabled = true;
      await services.write();
    }
    const response = await fetch(`${url}${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(endpoint === '/services' ? { biometrics: { enabled: false } } : {}) });
    assert.equal(response.status, 500);
    assert.match(JSON.stringify(await response.json()), /successful update repairs/);
    if (endpoint === '/services') {
      const services = (await import('../../db/services.js')).default;
      assert.equal(services.data.biometrics.enabled, true);
    }
  });
}
it('accepts an operation after its start succeeds', async () => {
  fail = false;
  const response = await fetch(`${url}/update/rollback`, { method: 'POST' });
  assert.equal(response.status, 204);
});

it('rejected admission cannot write or delete another operation target', async () => {
  fail = true; targetWrites.length = 0; targetDeletes.length = 0;
  for (const body of [{ targetVersion: '3.0.0', allowDowngrade: true }, {}]) {
    const response = await fetch(`${url}/update`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body) });
    assert.equal(response.status, 500);
  }
  assert.deepEqual(targetWrites, []);
  assert.deepEqual(targetDeletes, []);
});
it('a failed start removes only the target written after admission', async () => {
  fail = false; startFailed = true; targetWrites.length = 0; targetDeletes.length = 0;
  try {
    const response = await fetch(`${url}/update`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetVersion: '3.0.0', allowDowngrade: true }) });
    assert.equal(response.status, 500);
    assert.deepEqual(targetWrites, ['/persistent/free-sleep-data/update-target.json']);
    assert.deepEqual(targetDeletes, targetWrites);
  } finally { startFailed = false; }
});

const postJson = (endpoint: string, body: unknown) => fetch(`${url}${endpoint}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

it('starts an update, rollback or switch without handing Rhythms sleeps back', async () => {
  fail = false; handoffs.length = 0;
  assert.equal((await postJson('/update', {})).status, 204);
  assert.equal((await postJson('/update', { targetVersion: '3.4.0', allowDowngrade: true })).status, 204);
  assert.equal((await postJson('/update/rollback', {})).status, 204);
  assert.equal((await postJson('/update/switch-to-upstream', {})).status, 204);
  assert.equal((await postJson('/update/revert-to-stock', {})).status, 204);
  assert.deepEqual(handoffs, []);
});

it('hands Rhythms sleeps back when a script is about to stop the server', async () => {
  handoffs.length = 0;
  for (const reason of ['downgrade', 'rollback', 'revert']) {
    assert.equal((await postJson('/update/prepare-to-stop', { reason })).status, 204);
  }
  assert.deepEqual(handoffs, ['downgrade', 'rollback', 'revert']);
});

it('answers 204 to prepare-to-stop when the handoff fails', async () => {
  handoffs.length = 0; handoffFails = true;
  try {
    assert.equal((await postJson('/update/prepare-to-stop', { reason: 'rollback' })).status, 204);
  } finally {
    handoffFails = false;
  }
  assert.deepEqual(handoffs, ['rollback']);
});

it('tells the hook whether to hand Rhythms sleeps back', async () => {
  const update = await import('./update.js');
  const seen: unknown[] = [];
  update.setLeaveHook(async (reason, options) => { seen.push([reason, options]); });
  try {
    assert.equal((await postJson('/update/prepare-to-stop', { reason: 'rollback' })).status, 204);
    assert.equal((await postJson('/update/prepare-to-stop', { reason: 'downgrade', handBack: false })).status, 204);
  } finally {
    update.setLeaveHook((await import('../../jobs/rhythms/handoff.js')).prepareToLeaveRhythms);
  }
  assert.deepEqual(seen, [['rollback', { handBack: true }], ['downgrade', { handBack: false }]]);
});

it('refuses a prepare-to-stop body it does not know', async () => {
  handoffs.length = 0;
  for (const body of [{}, { reason: 'update' }, { reason: 'rollback', extra: true }, { reason: 'rollback', handBack: 'no' }]) {
    assert.equal((await postJson('/update/prepare-to-stop', body)).status, 400);
  }
  assert.deepEqual(handoffs, []);
});

it('accepts prepare-to-stop only from the Pod itself', async () => {
  const { isLoopbackAddress } = await import('./update.js');
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(address), true, address);
  for (const address of [undefined, '192.168.5.20', '::ffff:192.168.5.20', 'fe80::1']) {
    assert.equal(isLoopbackAddress(address), false, String(address));
  }
});

const lanAddress = Object.values(networkInterfaces()).flat()
  .find(entry => entry?.family === 'IPv4' && !entry.internal)?.address;

it('refuses prepare-to-stop from another host', { skip: !lanAddress && 'no LAN address' }, async () => {
  handoffs.length = 0;
  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://${lanAddress}:${port}/update/prepare-to-stop`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ reason: 'rollback' }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(handoffs, []);
});
