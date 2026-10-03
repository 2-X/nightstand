import { it, mock } from 'node:test';
import assert from 'node:assert/strict';

// Quick Biometrics toggles must end in the state of the last request, with
// the saved switch and the stream agreeing. Runs the real module with the
// privileged commands held until the test lets each one finish.
type Pending = { command: 'on' | 'off'; finish: () => void };
const pending: Pending[] = [];
const ran: string[] = [];
let stream: 'on' | 'off' = 'on';
let failNext: 'on' | 'off' | undefined;
mock.module('child_process', { namedExports: {
  execFile: (command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
    if (command === '/bin/systemctl') callback(null, 'loaded');
    else if (args.includes('-l')) callback(null, '');
    else {
      const action = args.includes('/bin/systemctl') ? 'on' : 'off';
      pending.push({
        command: action,
        finish: () => {
          ran.push(action);
          if (failNext === action) { failNext = undefined; callback(new Error('failed'), ''); return; }
          stream = action;
          callback(null, '');
        },
      });
    }
  },
} });
const { triggerBiometricsDisable, triggerBiometricsEnable } = await import('./biometrics.js');

let flag: 'on' | 'off' = 'on';
const save = (value: 'on' | 'off') => async () => { flag = value; return value; };
const request = (value: 'on' | 'off') => (value === 'on' ? triggerBiometricsEnable(save('on')) : triggerBiometricsDisable(save('off')));

// Lets each held command finish in turn, and checks that no two run at once.
async function settle(requests: Promise<unknown>[]) {
  let done = false;
  const all = Promise.allSettled(requests).then((results) => { done = true; return results; });
  while (!done) {
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(pending.length <= 1, 'one command at a time');
    pending.shift()?.finish();
  }
  return all;
}

for (const sequence of [['off', 'on', 'off'], ['on', 'off', 'on'], ['off', 'off', 'on', 'off']] as const) {
  it(`ends ${sequence.at(-1)} after ${sequence.join(', ')}`, async () => {
    ran.length = 0;
    const start = sequence[0] === 'on' ? 'off' : 'on';
    flag = start; stream = start;
    await settle(sequence.map(request));
    assert.deepEqual(ran, sequence, 'every request runs, in arrival order');
    assert.equal(stream, sequence.at(-1));
    assert.equal(flag, sequence.at(-1));
  });
}

it('saves nothing for a request whose command failed, and still runs the next', async () => {
  ran.length = 0;
  flag = 'off'; stream = 'off';
  failNext = 'on';
  const [on, off] = await settle([request('on'), request('off')]);
  assert.equal(on.status, 'rejected');
  assert.equal(off.status, 'fulfilled');
  assert.deepEqual(ran, ['on', 'off']);
  assert.equal(flag, 'off');
  assert.equal(stream, 'off');
});

it('returns what the save returned', async () => {
  const result = settle([triggerBiometricsEnable(async () => 'saved')]);
  assert.equal(((await result)[0] as PromiseFulfilledResult<string>).value, 'saved');
});
