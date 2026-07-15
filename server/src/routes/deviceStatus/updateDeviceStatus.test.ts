import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// config.ts throws if these aren't set, and reading it is what settingsDB.ts
// needs to resolve its lowdb path, must run before the dynamic imports
// below. A fresh temp dir keeps this test isolated from any real
// settingsDB.json on the machine running it.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-updateDeviceStatus-test-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';

// Regression test for a truthiness bug: `if (targetTemperatureF)` silently
// dropped an explicit `0` (a valid Fahrenheit target), since `0` is falsy.
// executeFunction talks to the Franken hardware socket, so it's mocked here
// rather than exercised for real.
const executeFunctionMock = mock.fn(async (...args: [string, string?]) => { void args; });
mock.module('../../8sleep/deviceApi.js', {
  namedExports: { executeFunction: executeFunctionMock },
});

const { updateDeviceStatus } = await import('./updateDeviceStatus.js');

describe('updateDeviceStatus', () => {
  it('applies an explicit targetTemperatureF of 0 instead of silently dropping it', async () => {
    executeFunctionMock.mock.resetCalls();

    await updateDeviceStatus({ left: { targetTemperatureF: 0 } });

    const levelCall = executeFunctionMock.mock.calls.find(
      (call) => call.arguments[0] === 'TEMP_LEVEL_LEFT',
    );
    assert.ok(levelCall, 'expected TEMP_LEVEL_LEFT to be sent for an explicit 0 target');
    // (0 - 82.5) / 27.5 * 100, rounded
    assert.equal(levelCall!.arguments[1], '-300');
  });

  it('still applies a normal positive targetTemperatureF', async () => {
    executeFunctionMock.mock.resetCalls();

    await updateDeviceStatus({ right: { targetTemperatureF: 82.5 } });

    const levelCall = executeFunctionMock.mock.calls.find(
      (call) => call.arguments[0] === 'TEMP_LEVEL_RIGHT',
    );
    assert.ok(levelCall);
    assert.equal(levelCall!.arguments[1], '0');
  });
});
