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

// Validate physical temperature bounds before any command can reach hardware.
const executeFunctionMock = mock.fn(async (...args: [string, string?]) => { void args; });
mock.module('../../8sleep/deviceApi.js', {
  namedExports: { executeFunction: executeFunctionMock },
});

mock.module('../../8sleep/frankenServer.js', { namedExports: {
  getDeviceStatusCoalesced: async () => ({ left: { targetTemperatureF: 82.5 }, right: { targetTemperatureF: 82.5 } }),
} });

const { updateDeviceStatus } = await import('./updateDeviceStatus.js');

describe('updateDeviceStatus', () => {
  it('rejects targets outside the hardware range', async () => {
    executeFunctionMock.mock.resetCalls();
    await assert.rejects(updateDeviceStatus({ left: { targetTemperatureF: 0 } }));
    assert.equal(executeFunctionMock.mock.calls.length, 0);
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
