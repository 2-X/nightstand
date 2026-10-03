import { it, mock } from 'node:test';
import assert from 'node:assert/strict';

const starts: string[] = [];
let finishStart: (() => void) | undefined;
mock.module('child_process', { namedExports: {
  execFile: (command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
    if (command === '/bin/systemctl') callback(null, args.includes('--property=ActiveState') ? 'inactive' : 'loaded');
    else if (args.includes('-l')) callback(null, '');
    else {
      starts.push(args.join(' '));
      finishStart = () => callback(null, '');
    }
  },
} });
const { triggerBiometricsDisable } = await import('./biometrics.js');

const takeStart = async () => {
  while (!finishStart) await new Promise(resolve => setImmediate(resolve));
  const finish = finishStart;
  finishStart = undefined;
  return finish;
};

// Requests are not merged, so a later request never shares an earlier one's
// result; they run one at a time instead.
it('runs concurrent disables one after another', async () => {
  const requests = Array.from({ length: 3 }, () => triggerBiometricsDisable());
  for (let i = 1; i <= 3; i++) {
    const finish = await takeStart();
    assert.equal(starts.length, i, 'the next one starts only after this one finished');
    finish();
  }
  await Promise.all(requests);
  assert.equal(starts.length, 3);
});

it('runs again once the previous disable finished', async () => {
  const request = triggerBiometricsDisable();
  (await takeStart())();
  await request;
  assert.equal(starts.length, 4);
});
