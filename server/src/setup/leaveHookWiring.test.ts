import assert from 'node:assert/strict';
import { after, before, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-leave-hook-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const handoffs: string[] = [];
mock.module(new URL('../jobs/rhythms/handoff.js', import.meta.url).href, { namedExports: {
  prepareToLeaveRhythms: async (reason: string) => {
    handoffs.push(reason);
    return { sides: [] };
  },
  disableRhythms: async () => ({ sides: [] }),
} });

let server: Server;
let url: string;
before(async () => {
  const app = express();
  app.use(express.json());
  (await import('./routes.js')).default(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
  rmSync(folder, { recursive: true, force: true });
});

it('the mounted routes hand Rhythms sleeps back when a script prepares to stop', async () => {
  const response = await fetch(`${url}/api/update/prepare-to-stop`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'revert' }),
  });
  assert.equal(response.status, 204);
  assert.deepEqual(handoffs, ['revert']);
});
