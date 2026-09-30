import { test, mock, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net, { type Socket, type AddressInfo } from 'node:net';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-franken-connect-loop-'));
mkdirSync(path.join(folder, 'lowdb'));
const previousEnv = {
  DATA_FOLDER: process.env.DATA_FOLDER,
  ENV: process.env.ENV,
  FRANKEN_CONNECTION_TIMEOUT_MS: process.env.FRANKEN_CONNECTION_TIMEOUT_MS,
};
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

type FakeServer = { deliver?: (socket: Socket) => void };
const servers: FakeServer[] = [];
// When set, the next server close waits for this promise.
let holdClose: Promise<void> | undefined;
mock.module(new URL('./unixSocketServer.js', import.meta.url).href, {
  namedExports: { UnixSocketServer: class {
    static async start() {
      const server: FakeServer = {};
      servers.push(server);
      return {
        waitForConnection: () => new Promise<Socket>(resolve => { server.deliver = resolve; }),
        close: async () => {
          const hold = holdClose;
          holdClose = undefined;
          await hold;
        },
      };
    }
  } },
});

process.env.FRANKEN_CONNECTION_TIMEOUT_MS = '100';
const timed = await import('./frankenServer.js');
process.env.FRANKEN_CONNECTION_TIMEOUT_MS = '0';
const untimedSuffix = 'untimed';
const untimed: typeof timed = await import(`./frankenServer.js?${untimedSuffix}`);

const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await new Promise<void>(resolve => listener.once('listening', resolve));
const sockets: Socket[] = [];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function newSocket() {
  const accepted = new Promise<Socket>(resolve => listener.once('connection', resolve));
  const client = net.createConnection((listener.address() as AddressInfo).port, '127.0.0.1');
  sockets.push(client, await accepted);
  return client;
}

afterEach(async () => {
  await timed.disconnectFranken();
  await untimed.disconnectFranken();
  servers.length = 0;
  holdClose = undefined;
  sockets.splice(0).forEach(socket => socket.destroy());
});
after(async () => {
  await new Promise<void>(resolve => listener.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('a connection timeout of 0 sets no timeout while waiting for the firmware', async t => {
  const delays: unknown[] = [];
  const original = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', ((callback: () => void, ms?: number, ...args: unknown[]) => {
    delays.push(ms);
    return original(callback, ms, ...args);
  }) as unknown as typeof setTimeout);
  const connecting = untimed.connectFranken();
  await pause(400);
  assert.equal(servers.length, 1, 'the socket server was restarted');
  assert.ok(!delays.includes(25_000), 'the default timeout was applied');
  servers[0].deliver?.(await newSocket());
  await connecting;
  assert.equal(untimed.isFrankenConnected(), true);
});

test('a positive connection timeout restarts the socket server while waiting', async () => {
  const connecting = timed.connectFranken();
  await pause(400);
  assert.ok(servers.length > 1, 'the socket server was never restarted');
  servers.at(-1)?.deliver?.(await newSocket());
  await connecting;
});

test('a connect loop retired while its server closes does not carry on with the next loop\'s server', async () => {
  let release!: () => void;
  holdClose = new Promise<void>(resolve => { release = resolve; });
  const stale = timed.connectFranken();
  const staleOutcome = stale.then(() => 'connected', (error: unknown) => error);
  // The stale loop times out and is closing its server.
  await pause(250);
  await timed.disconnectFranken();
  const fresh = timed.connectFranken();
  await pause(20);
  release();
  const outcome = await Promise.race([staleOutcome, pause(500).then(() => 'still waiting')]);
  assert.ok(outcome instanceof timed.FrankenUnavailableError, `the stale loop ended with: ${String(outcome)}`);
  servers.at(-1)?.deliver?.(await newSocket());
  await fresh;
  assert.equal(timed.isFrankenConnected(), true);
});
