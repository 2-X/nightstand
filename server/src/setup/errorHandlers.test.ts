import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-error-handlers-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const { FrankenCommandTimeoutError, FrankenUnavailableError } = await import('../8sleep/frankenServer.js');
const { registerErrorHandlers } = await import('./errorHandlers.js');

const app = express();
app.use(express.json());
app.post('/unavailable', () => { throw new FrankenUnavailableError(); });
app.post('/timeout', () => { throw new FrankenCommandTimeoutError('11', 5_000); });
app.post('/echo', (req, res) => { res.json(req.body); });
registerErrorHandlers(app);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});

const post = async (route: string, body = '{}') => {
  const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return { status: response.status, body: await response.json() as { error: { message: string; stack?: string } } };
};

test('a command without a hardware connection answers 503', async () => {
  const response = await post('/unavailable');
  assert.equal(response.status, 503);
  assert.match(response.body.error.message, /not connected/);
});

test('a command the hardware did not answer answers 503', async () => {
  const response = await post('/timeout');
  assert.equal(response.status, 503);
  assert.match(response.body.error.message, /did not respond/);
});

test('malformed JSON still answers 400', async () => {
  const response = await post('/echo', '{');
  assert.equal(response.status, 400);
  assert.equal(response.body.error.message, 'Invalid JSON');
});
