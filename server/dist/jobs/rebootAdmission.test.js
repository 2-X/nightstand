import { after, beforeEach, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-reboot-admission-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const reboots = [];
const starts = [];
let holdLoadCheck;
mock.module('child_process', { namedExports: {
        exec: (_command, callback) => { reboots.push(callback); },
        execFile: (command, args, _options, callback) => {
            if (command === '/bin/systemctl' && args.includes('--property=ActiveState'))
                callback(null, 'inactive');
            else if (command === '/bin/systemctl' && holdLoadCheck)
                holdLoadCheck(() => callback(null, 'loaded'));
            else if (command === '/bin/systemctl')
                callback(null, 'loaded');
            else {
                if (!args.includes('-l'))
                    starts.push(args.join(' '));
                callback(null, '');
            }
        },
    } });
const { default: reboot } = await import('./reboot.js');
const { triggerUpdateService } = await import('./update.js');
const { triggerRollbackService } = await import('./rollback.js');
const { default: jobsRouter } = await import('../routes/jobs/jobs.js');
const { default: updateRouter } = await import('../routes/update/update.js');
const app = express();
app.use(express.json(), jobsRouter);
app.use('/update', updateRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const url = `${base}/jobs`;
after(async () => {
    await new Promise(resolve => server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
});
const postJobs = async (jobs) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jobs) });
    await response.text();
    return response.status;
};
// Settle the outstanding reboot as failed, which is how the latch clears
// when the Pod did not go down.
const failPendingReboots = () => reboots.splice(0).forEach(callback => callback(new Error('reboot failed'), '', ''));
beforeEach(() => {
    failPendingReboots();
    starts.length = 0;
    holdLoadCheck = undefined;
});
it('refuses reboot and update in one request before starting either', async () => {
    assert.equal(await postJobs(['reboot', 'update']), 400);
    assert.equal(await postJobs(['update', 'reboot']), 400);
    assert.equal(reboots.length, 0);
    assert.deepEqual(starts, []);
});
it('refuses operations after a reboot was issued', async () => {
    await reboot();
    await assert.rejects(triggerUpdateService(), /restarting/);
    await assert.rejects(triggerRollbackService(), /restarting/);
    assert.deepEqual(starts, []);
});
it('issues one reboot for parallel requests', async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => reboot()));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(reboots.length, 1);
});
it('refuses a reboot while an update is being admitted', async () => {
    let release;
    holdLoadCheck = next => { release = next; };
    const update = triggerUpdateService();
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(reboot(), /already running/);
    holdLoadCheck = undefined;
    release?.();
    await update;
    assert.equal(reboots.length, 0);
});
it('lets operations start again after a reboot fails', async () => {
    await reboot();
    failPendingReboots();
    await triggerUpdateService();
    assert.equal(starts.length, 1);
});
it('reports a refused operation as a conflict, not a failure', async () => {
    await reboot();
    assert.equal(await postJobs(['update']), 409);
    assert.equal(await postJobs(['reboot']), 409);
    const rollback = await fetch(`${base}/update/rollback`, { method: 'POST' });
    assert.equal(rollback.status, 409);
    assert.match((await rollback.json()).message, /restarting/);
});
//# sourceMappingURL=rebootAdmission.test.js.map