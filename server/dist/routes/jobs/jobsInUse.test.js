import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
const folder = mkdtempSync(path.join(tmpdir(), 'jobs-in-use-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
let reasons = [];
const started = [];
const trigger = async () => { started.push('update'); };
mock.module(new URL('../../jobs/update.js', import.meta.url).href, {
    defaultExport: trigger, namedExports: { triggerUpdateService: trigger },
});
mock.module(new URL('../../jobs/reboot.js', import.meta.url).href, {
    defaultExport: async () => { started.push('reboot'); },
});
let server;
let url;
before(async () => {
    const app = express();
    app.use(express.json());
    const update = await import('../update/update.js');
    update.setInUseCheck(async () => reasons);
    app.use((await import('./jobs.js')).default);
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
beforeEach(() => {
    reasons = [];
    started.length = 0;
});
const postJobs = async (jobs) => {
    const response = await fetch(`${url}/jobs`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(jobs),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) };
};
describe('POST /jobs with update', () => {
    for (const [name, reason, start] of [
        ['a side is on', 'left-on', /^A side is on\./],
        ['an alarm is soon', 'alarm-soon', /^An alarm is due in the next 15 minutes\./],
        ['the state is unknown', 'status-unknown', /^Nightstand cannot read the bed's state/],
    ]) {
        it(`refuses when ${name}, without starting anything`, async () => {
            reasons = [reason];
            const response = await postJobs(['update']);
            assert.equal(response.status, 409);
            assert.deepEqual(response.body.reasons, [reason]);
            assert.match(response.body.error, start);
            assert.equal(response.body.message, response.body.error);
            assert.deepEqual(started, []);
        });
    }
    it('refuses the other jobs in the same request too', async () => {
        reasons = ['right-on'];
        assert.equal((await postJobs(['update', 'analyzeSleepLeft'])).status, 409);
        assert.deepEqual(started, []);
    });
    it('has no way to confirm', async () => {
        reasons = ['left-on'];
        const response = await fetch(`${url}/jobs?confirmInUse=true`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(['update']),
        });
        assert.equal(response.status, 409);
        assert.deepEqual(started, []);
    });
    it('starts the update when the bed is idle', async () => {
        assert.equal((await postJobs(['update'])).status, 204);
        assert.deepEqual(started, ['update']);
    });
    it('refuses when no check is registered or the check throws', async () => {
        const update = await import('../update/update.js');
        update.setInUseCheck(async () => { throw new Error('boom'); });
        try {
            const response = await postJobs(['update']);
            assert.equal(response.status, 409);
            assert.deepEqual(response.body.reasons, ['status-unknown']);
        }
        finally {
            update.setInUseCheck(async () => reasons);
        }
    });
    it('leaves a restart alone', async () => {
        reasons = ['left-on'];
        assert.equal((await postJobs(['reboot'])).status, 204);
        assert.deepEqual(started, ['reboot']);
    });
});
//# sourceMappingURL=jobsInUse.test.js.map