import { it, mock } from 'node:test';
import assert from 'node:assert/strict';

const starts: string[] = [];
let finishStart: (() => void) | undefined;
mock.module('child_process', { namedExports: {
  execFile: (command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
    if (command === '/bin/systemctl') callback(null, 'loaded');
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

it('runs one disable for concurrent requests and reports it to each', async () => {
  const requests = Array.from({ length: 5 }, () => triggerBiometricsDisable());
  (await takeStart())();
  await Promise.all(requests);
  assert.equal(starts.length, 1);
});

it('runs again once the previous disable finished', async () => {
  const request = triggerBiometricsDisable();
  (await takeStart())();
  await request;
  assert.equal(starts.length, 2);
});
