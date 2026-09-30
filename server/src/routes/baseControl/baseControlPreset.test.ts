import assert from 'node:assert/strict';
import { after, beforeEach, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-base-preset-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const positions: unknown[] = [];
mock.module(new URL('../../8sleep/trimixBaseControl.js', import.meta.url).href, {
  namedExports: { trimixBase: { setPosition: async (position: unknown) => { positions.push(position); } } },
});
const { default: router } = await import('./baseControl.js');
const app = express();
app.use(express.json(), router);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/base-control/preset`;
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});
beforeEach(() => { positions.length = 0; });

const post = async (body?: string) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  await response.text();
  return response.status;
};

it('refuses inherited object keys as preset names', async () => {
  for (const preset of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(await post(JSON.stringify({ preset })), 400, preset);
  }
  assert.deepEqual(positions, []);
});

it('answers 400 when the body is missing', async () => {
  assert.equal(await post(), 400);
});

it('moves the base for a real preset', async () => {
  assert.equal(await post(JSON.stringify({ preset: 'flat' })), 200);
  assert.equal(positions.length, 1);
});
