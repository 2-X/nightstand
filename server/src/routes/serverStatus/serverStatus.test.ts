import assert from 'node:assert/strict';
import { after, before, it, mock } from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The full status rewrites the services file, so the health check, which
// asks every minute, uses the liveness answer instead.
let statusReads = 0;
mock.module(new URL('../../serverStatus.js', import.meta.url).href, { defaultExport: {
  toJSON: async () => { statusReads += 1; return {}; },
} });

let server: Server;
let url: string;
before(async () => {
  const app = express();
  app.use('/api/serverStatus', (await import('./serverStatus.js')).default);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));

it('answers the liveness check without reading the full status', async () => {
  const response = await fetch(`${url}/api/serverStatus/alive`);
  assert.equal(response.status, 204);
  assert.equal(statusReads, 0);
});

it('still serves the full status', async () => {
  const response = await fetch(`${url}/api/serverStatus`);
  assert.equal(response.status, 200);
  assert.equal(statusReads, 1);
});
