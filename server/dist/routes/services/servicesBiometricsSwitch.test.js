import assert from 'node:assert/strict';
import { after, beforeEach, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
// The app's Biometrics switch posts biometrics.enabled. Off stops and
// disables the stream; on enables and starts it. The flag is saved only once
// the command succeeded, so the switch never reads on with the stream off.
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-services-switch-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const runs = [];
let fail = false;
let busy = false;
const { OperationBusyError, PrivilegedCommandError } = await import('../../jobs/privilegedCommand.js');
const run = (name) => async (save) => {
    runs.push(name);
    if (busy)
        throw new OperationBusyError('An update, rollback or switch is already running. Wait for it to finish.');
    if (fail)
        throw new PrivilegedCommandError('Cannot run free-sleep-stream.service: A successful update repairs these rules and services.');
    return save?.();
};
mock.module(new URL('../../jobs/biometrics.js', import.meta.url).href, {
    namedExports: {
        shouldDisableBiometrics: (body) => body.biometrics?.enabled === false,
        shouldEnableBiometrics: (body) => body.biometrics?.enabled === true,
        triggerBiometricsDisable: run('disable'),
        triggerBiometricsEnable: run('enable'),
        reconcileBiometrics: async () => { },
    },
});
const { default: router } = await import('./services.js');
const { default: servicesDB } = await import('../../db/services.js');
const app = express();
app.use(express.json(), router);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}/services`;
after(async () => {
    await new Promise(resolve => server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
});
beforeEach(() => { runs.length = 0; fail = false; busy = false; });
const post = (body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const enabled = async () => { await servicesDB.read(); return servicesDB.data.biometrics.enabled; };
it('turns the stream on when the switch is saved on', async () => {
    const response = await post({ biometrics: { enabled: true } });
    assert.equal(response.status, 200);
    assert.deepEqual(runs, ['enable']);
    assert.equal(await enabled(), true);
});
it('turns the stream off when the switch is saved off', async () => {
    const response = await post({ biometrics: { enabled: false } });
    assert.equal(response.status, 200);
    assert.deepEqual(runs, ['disable']);
    assert.equal(await enabled(), false);
});
it('leaves the switch off and says why when the stream cannot be turned on', async () => {
    fail = true;
    const response = await post({ biometrics: { enabled: true } });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /successful update repairs/);
    assert.equal(await enabled(), false);
});
for (const enabledValue of [true, false]) {
    it(`answers 409 and keeps the switch when turning it ${enabledValue ? 'on' : 'off'} during an update`, async () => {
        busy = true;
        const before = await enabled();
        const response = await post({ biometrics: { enabled: enabledValue } });
        assert.equal(response.status, 409);
        assert.equal((await response.json()).error, 'An update, rollback or switch is already running. Wait for it to finish.');
        assert.equal(await enabled(), before);
    });
}
it('saves the switch with the command, so it is not saved before the command ran', async () => {
    // The route hands its save to the queued command rather than saving after.
    const response = await post({ biometrics: { enabled: true, jobs: { stream: { status: 'healthy' } } } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.biometrics.enabled, true);
    assert.equal(body.biometrics.jobs.stream.status, 'healthy');
});
it('runs nothing for a job status update', async () => {
    const response = await post({ biometrics: { jobs: { stream: { status: 'healthy' } } } });
    assert.equal(response.status, 200);
    assert.deepEqual(runs, []);
});
//# sourceMappingURL=servicesBiometricsSwitch.test.js.map