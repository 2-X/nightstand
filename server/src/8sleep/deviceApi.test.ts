import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

// Resolves the connection when a test says the Pod is reachable.
let connect: () => void = () => {};
const calls: [string, string][] = [];
const franken = { callFunction: async (command: string, arg: string) => { calls.push([command, arg]); } };
mock.module(new URL('./frankenServer.js', import.meta.url).href, {
  namedExports: {
    connectFrankenWithin: () => new Promise(resolve => { connect = () => resolve(franken); }),
  },
});

const { executeFunction } = await import('./deviceApi.js');

describe('executeFunction', () => {
  it('works out a deferred argument once the Pod is reachable', async () => {
    let seconds = 600;
    const sending = executeFunction('LEFT_TEMP_DURATION', () => String(seconds), { background: true, latest: true });
    await Promise.resolve();
    seconds = 300;
    connect();
    await sending;
    assert.deepEqual(calls, [['LEFT_TEMP_DURATION', '300']]);
  });
});
