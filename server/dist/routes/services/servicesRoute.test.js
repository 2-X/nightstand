import assert from 'node:assert/strict';
import { after, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-services-route-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
mock.module(new URL('../../jobs/biometrics.js', import.meta.url).href, {
    namedExports: {
        shouldDisableBiometrics: () => false, triggerBiometricsDisable: async () => { },
        shouldEnableBiometrics: () => false, triggerBiometricsEnable: async () => { },
        reconcileBiometrics: async () => { },
    },
});
const { default: router } = await import('./services.js');
const { default: servicesDB } = await import('../../db/services.js');
const { MAX_JOB_MESSAGE_LENGTH } = await import('./services.js');
const app = express();
app.use(express.json({ limit: '1mb' }), router);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}/services`;
after(async () => {
    await new Promise(resolve => server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
});
it('stores a shortened job message instead of an unbounded one', async () => {
    const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ biometrics: { jobs: { stream: { status: 'failed', message: `Traceback ${'x'.repeat(90_000)}` } } } }),
    });
    assert.equal(response.status, 200);
    await servicesDB.read();
    const stored = servicesDB.data.biometrics.jobs.stream.message;
    assert.ok(stored.startsWith('Traceback '));
    assert.ok(stored.length <= MAX_JOB_MESSAGE_LENGTH);
    assert.equal(servicesDB.data.biometrics.jobs.stream.status, 'failed');
});
//# sourceMappingURL=servicesRoute.test.js.map